sap.ui.define([], function () {
	"use strict";

	/*
	 * The HRX service (OData V4, CAP) - the app's backend.
	 *
	 * Deployed, /hrx goes through the "hrxservices" destination (xs-app.json), which
	 * signs the call in as the user. Locally, ui5.yaml proxies /hrx to a CAP service on
	 * localhost:4004 - the deployed one only answers a signed-in user, so a local
	 * preview needs its own copy of the service running (see README).
	 *
	 * Plain fetch rather than an ODataModel: the pages keep the JSON models they already
	 * bind against, and the service's functions answer with JSON the pages reshape
	 * anyway. Like Backend.SERVICE_ROOT, the root is resolved from the app's own url so
	 * it still works once the app sits under a path of its own in the launchpad.
	 */
	var ROOT = new URL(
		sap.ui.require.toUrl("bsx/hrx/hrx2026") + "/hrx",
		document.baseURI
	).href;

	// Where the service keeps pictures and logos when a row does not name its repository.
	var PICTURE_REPOSITORY = "0dc65852-e10f-4a43-8cab-43397e9739e4";

	// The service pages large reads; following nextLink stops at this many pages so a
	// runaway read cannot hang the page.
	var MAX_PAGES = 50;

	function errorFrom(oResponse, sBody) {
		var sMessage = oResponse.statusText || ("HTTP " + oResponse.status);
		try {
			var oJson = JSON.parse(sBody);
			sMessage = (oJson.error && (oJson.error.message || oJson.error.code)) || oJson.message || sMessage;
		} catch (oParseError) {
			if (sBody) {
				sMessage = sBody.slice(0, 300);
			}
		}
		var oError = new Error(sMessage);
		oError.status = oResponse.status;
		return oError;
	}

	// The approuter guards /hrx against cross-site requests (xs-app.json, csrfProtection),
	// so every write carries a token fetched once and fetched again when it expires.
	var pCsrfToken = null;

	function csrfToken(bRenew) {
		if (!pCsrfToken || bRenew) {
			pCsrfToken = fetch(ROOT + "/", { method: "HEAD", credentials: "same-origin", headers: { "X-CSRF-Token": "Fetch" } })
				.then(function (oResponse) {
					return oResponse.headers.get("X-CSRF-Token") || "";
				}, function () {
					return "";
				});
		}
		return pCsrfToken;
	}

	function send(sUrl, oInit, bRetried) {
		var oOptions = Object.assign({ credentials: "same-origin" }, oInit);
		oOptions.headers = Object.assign({ Accept: "application/json" }, oOptions.headers);
		var bWrite = oOptions.method && oOptions.method !== "GET";

		return (bWrite ? csrfToken() : Promise.resolve("")).then(function (sToken) {
			if (sToken) {
				oOptions.headers["X-CSRF-Token"] = sToken;
			}
			return fetch(sUrl, oOptions);
		}).then(function (oResponse) {
			// An expired token is answered 403 "Required": fetch a fresh one and try once more.
			if (bWrite && !bRetried && oResponse.status === 403 && /required/i.test(oResponse.headers.get("X-CSRF-Token") || "")) {
				return csrfToken(true).then(function () {
					return send(sUrl, oInit, true);
				});
			}
			return oResponse.text().then(function (sBody) {
				if (!oResponse.ok) {
					throw errorFrom(oResponse, sBody);
				}
				return sBody ? JSON.parse(sBody) : null;
			});
		});
	}

	/**
	 * Formats a value as an OData V4 literal for a function parameter or a filter.
	 * @param {*} vValue a string, number, boolean, null or Date
	 * @returns {string} the literal
	 */
	function literal(vValue) {
		if (vValue === null || vValue === undefined) {
			return "null";
		}
		if (vValue instanceof Date) {
			return vValue.getFullYear() + "-" + String(vValue.getMonth() + 1).padStart(2, "0") + "-" +
				String(vValue.getDate()).padStart(2, "0");
		}
		if (typeof vValue === "number" || typeof vValue === "boolean") {
			return String(vValue);
		}
		// A plain calendar day or a GUID is a bare literal in V4; anything else is a string.
		if (/^\d{4}-\d{2}-\d{2}$/.test(vValue) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vValue)) {
			return vValue;
		}
		return "'" + String(vValue).replace(/'/g, "''") + "'";
	}

	function query(oParams) {
		var aParts = [];
		Object.keys(oParams || {}).forEach(function (sKey) {
			var vValue = oParams[sKey];
			if (vValue !== undefined && vValue !== null && vValue !== "") {
				aParts.push(sKey + "=" + encodeURIComponent(vValue).replace(/%24/g, "$").replace(/%2C/g, ",")
					.replace(/%28/g, "(").replace(/%29/g, ")").replace(/%3D/g, "="));
			}
		});
		return aParts.length ? "?" + aParts.join("&") : "";
	}

	return {

		ROOT: ROOT,

		literal: literal,

		/**
		 * Reads every row of an entity set, following the service's paging.
		 * @param {string} sPath e.g. "TimeLog"
		 * @param {object} [oParams] system query options: $filter, $expand, $select, $orderby
		 * @returns {Promise<Array<object>>} the rows
		 */
		list: function (sPath, oParams) {
			var aRows = [];
			var iPage = 0;

			var fnPage = function (sUrl) {
				return send(sUrl).then(function (oJson) {
					aRows = aRows.concat((oJson && oJson.value) || []);
					var sNext = oJson && oJson["@odata.nextLink"];
					if (sNext && ++iPage < MAX_PAGES) {
						return fnPage(new URL(sNext, ROOT + "/").href);
					}
					return aRows;
				});
			};

			return fnPage(ROOT + "/" + sPath + query(oParams));
		},

		/**
		 * @param {string} sPath an entity, e.g. "Users('S000000010')"
		 * @param {object} [oParams] $expand, $select
		 * @returns {Promise<object>} the entity
		 */
		get: function (sPath, oParams) {
			return send(ROOT + "/" + sPath + query(oParams));
		},

		create: function (sEntitySet, oBody) {
			return send(ROOT + "/" + sEntitySet, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(oBody)
			});
		},

		update: function (sPath, oBody) {
			return send(ROOT + "/" + sPath, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(oBody)
			});
		},

		remove: function (sPath) {
			return send(ROOT + "/" + sPath, { method: "DELETE" });
		},

		/**
		 * Calls an unbound function. The service declares its functions as returning
		 * strings but answers with JSON; either way comes back parsed.
		 * @param {string} sName the function
		 * @param {object} [oArgs] its parameters
		 * @returns {Promise<*>} the result ("value" unwrapped)
		 */
		callFunction: function (sName, oArgs) {
			var sArgs = Object.keys(oArgs || {}).map(function (sKey) {
				return sKey + "=" + encodeURIComponent(literal(oArgs[sKey]));
			}).join(",");

			return send(ROOT + "/" + sName + "(" + sArgs + ")").then(this._unwrap);
		},

		/**
		 * Calls an unbound action.
		 * @param {string} sName the action
		 * @param {object} oBody its parameters
		 * @returns {Promise<*>} the result ("value" unwrapped)
		 */
		callAction: function (sName, oBody) {
			return send(ROOT + "/" + sName, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(oBody || {})
			}).then(this._unwrap);
		},

		/**
		 * A function result is { value: ... }, and the value may itself be JSON in a
		 * string (or an array of them) - the declared return type is String.
		 * @param {object} oJson the response
		 * @returns {*} the payload
		 */
		_unwrap: function (oJson) {
			var fnParse = function (vValue) {
				if (typeof vValue === "string") {
					try {
						return JSON.parse(vValue);
					} catch (oError) {
						return vValue;
					}
				}
				return vValue;
			};
			var vValue = oJson && Object.prototype.hasOwnProperty.call(oJson, "value") ? oJson.value : oJson;
			return Array.isArray(vValue) ? vValue.map(fnParse) : fnParse(vValue);
		},

		/**
		 * Stores a picture or logo in SAP Document Management through the service's
		 * Documents entity, which also records it on the user (ImageObjectID) or client
		 * (LogoObjectID).
		 * @param {string} sObjectType "User" or "Client"
		 * @param {string} sObjectId the EmployeeID or client ID
		 * @param {string} sCurrentId the picture it replaces (its ImageObjectID / LogoObjectID), or ""
		 * @param {Blob} oFile the image
		 * @param {string} sFileName its file name (the extension is kept)
		 * @returns {Promise} settles once stored
		 */
		upload: function (sObjectType, sObjectId, sCurrentId, oFile, sFileName) {
			var oForm = new FormData();
			oForm.append("file", oFile, sFileName);
			return send(ROOT + "/Documents(objectID=" + literal(String(sObjectId)) + ",objectType=" + literal(sObjectType) +
				",objectFolderID=" + literal(String(sCurrentId || "")) + ")/content", { method: "PUT", body: oForm });
		},

		/**
		 * A stored picture's address: SAP Document Management, through the app's /browser
		 * route (xs-app.json, destination dms_service).
		 * @param {string} sRepositoryId ImageRootID / LogoRootID
		 * @param {string} sObjectId ImageObjectID / LogoObjectID
		 * @returns {string} the url, or "" when there is no picture
		 */
		pictureUrl: function (sRepositoryId, sObjectId) {
			if (!sObjectId) {
				return "";
			}
			return new URL(sap.ui.require.toUrl("bsx/hrx/hrx2026") + "/browser/" + encodeURIComponent(sRepositoryId || PICTURE_REPOSITORY) +
				"/root?cmisselector=content&objectId=" + encodeURIComponent(sObjectId), document.baseURI).href;
		},

		/**
		 * "hh:mm:ss" as the service stores a duration of time booked.
		 * @param {number} iMinutes minutes
		 * @returns {string} the Edm.TimeOfDay literal
		 */
		toTime: function (iMinutes) {
			var iWhole = Math.max(0, Math.round(iMinutes || 0));
			return String(Math.floor(iWhole / 60)).padStart(2, "0") + ":" + String(iWhole % 60).padStart(2, "0") + ":00";
		}
	};
});
