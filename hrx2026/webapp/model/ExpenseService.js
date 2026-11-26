sap.ui.define([], function () {
	"use strict";

	/*
	 * The expense service (OData V4, CAP; bluestonex-labs/ExpenseService), which holds
	 * the expense claims, their items, mileage and receipts, the approval workflow and
	 * the expense policy. It has two parts:
	 *  - /expense   the signed-in employee's own claims (My Expenses)
	 *  - /approval  approving claims, the dashboard, history and settings
	 *
	 * Deployed, both go through the "expenseservice" destination (xs-app.json), which
	 * signs the call in as the user; what they may do is decided by their expense role
	 * (Employee, Approver, Admin) in BTP.
	 *
	 * Claims are CAP drafts: a claim being edited is a draft copy (IsActiveEntity=false)
	 * that every change is written to straight away, and "activating" it saves it as the
	 * claim. A claim is only submitted once saved.
	 *
	 * Plain fetch, like model/Hrx.js: the pages bind JSON models of their own.
	 */
	var APP_ROOT = sap.ui.require.toUrl("bsx/hrx/hrx2026");
	var EXPENSE_ROOT = new URL(APP_ROOT + "/expense", document.baseURI).href;
	var APPROVAL_ROOT = new URL(APP_ROOT + "/approval", document.baseURI).href;

	function errorFrom(oResponse, sBody) {
		var sMessage = oResponse.statusText || ("HTTP " + oResponse.status);
		try {
			var oJson = JSON.parse(sBody);
			var oError = oJson.error || {};
			// A failed validation lists every problem in details
			var aDetails = (oError.details || []).map(function (oDetail) {
				return oDetail.message;
			}).filter(Boolean);
			sMessage = aDetails.length ? aDetails.join("\n") : (oError.message || oError.code || sMessage);
		} catch (oParseError) {
			if (sBody) {
				sMessage = sBody.slice(0, 300);
			}
		}
		var oResult = new Error(sMessage);
		oResult.status = oResponse.status;
		return oResult;
	}

	// The approuter guards writes against cross-site requests (csrfProtection), so every
	// write carries a token fetched once and fetched again when it expires.
	var pCsrfToken = null;

	function csrfToken(bRenew) {
		if (pCsrfToken && !bRenew) {
			return pCsrfToken;
		}
		pCsrfToken = fetch(EXPENSE_ROOT + "/", {
			method: "HEAD",
			credentials: "same-origin",
			headers: { "X-CSRF-Token": "Fetch" }
		}).then(function (oResponse) {
			return oResponse.headers.get("X-CSRF-Token") || "";
		}, function () {
			return "";
		});
		return pCsrfToken;
	}

	function isCsrfTokenExpired(oResponse) {
		var sTokenHeader = oResponse.headers.get("X-CSRF-Token") || "";
		return oResponse.status === 403 && sTokenHeader.toLowerCase() === "required";
	}

	// Just after the app is deployed, the launchpad (the managed approuter) can still be
	// working from its cached copy of the app's routes (xs-app.json) for a few minutes.
	// Until it has the new copy, /expense and /approval are not routes it knows, and it
	// answers them from the app's own files with 404 "File not found". Such an answer
	// is waited out and the request sent again, a few times, before giving up with a
	// message that says what is happening.
	var ROUTES_NOT_READY_RETRIES = 4;
	var ROUTES_NOT_READY_WAIT_MS = 8000;

	function isRoutesNotReady(oResponse, sBody) {
		return oResponse.status === 404 && String(sBody).trim() === "File not found";
	}

	function wait(iMs) {
		return new Promise(function (resolve) {
			setTimeout(resolve, iMs);
		});
	}

	/**
	 * Sends a request and answers its JSON (or null for an empty answer).
	 * @param {string} sUrl the full url
	 * @param {object} [oInit] fetch options
	 * @param {boolean} [bRetried] true on the second go after a fresh CSRF token
	 * @param {number} [iRouteTries] how many times the routes were not ready yet
	 * @returns {Promise<object|null>} the answer
	 */
	function send(sUrl, oInit, bRetried, iRouteTries) {
		var oOptions = Object.assign({ credentials: "same-origin" }, oInit);
		oOptions.headers = Object.assign({ Accept: "application/json" }, oOptions.headers);
		var bWrite = oOptions.method && oOptions.method !== "GET";

		return (bWrite ? csrfToken() : Promise.resolve("")).then(function (sToken) {
			if (sToken) {
				oOptions.headers["X-CSRF-Token"] = sToken;
			}
			return fetch(sUrl, oOptions);
		}).then(function (oResponse) {
			if (bWrite && !bRetried && isCsrfTokenExpired(oResponse)) {
				return csrfToken(true).then(function () {
					return send(sUrl, oInit, true, iRouteTries);
				});
			}
			return oResponse.text().then(function (sBody) {
				if (isRoutesNotReady(oResponse, sBody)) {
					var iTries = (iRouteTries || 0) + 1;
					if (iTries <= ROUTES_NOT_READY_RETRIES) {
						return wait(ROUTES_NOT_READY_WAIT_MS).then(function () {
							return send(sUrl, oInit, bRetried, iTries);
						});
					}
					var oNotReady = new Error("Expenses is being updated. Try again in a few minutes.");
					oNotReady.status = 503;
					throw oNotReady;
				}
				if (!oResponse.ok) {
					throw errorFrom(oResponse, sBody);
				}
				return sBody ? JSON.parse(sBody) : null;
			});
		});
	}

	function jsonRequest(sMethod, oBody) {
		return {
			method: sMethod,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(oBody || {})
		};
	}

	function query(oParams) {
		var aParts = [];
		Object.keys(oParams || {}).forEach(function (sKey) {
			var vValue = oParams[sKey];
			if (vValue !== undefined && vValue !== null && vValue !== "") {
				aParts.push(sKey + "=" + encodeURIComponent(vValue));
			}
		});
		return aParts.length ? "?" + aParts.join("&") : "";
	}

	/**
	 * @param {*} vValue a string, number, boolean or null
	 * @returns {string} the value as an OData V4 literal for a function parameter
	 */
	function literal(vValue) {
		if (vValue === null || vValue === undefined || vValue === "") {
			return "null";
		}
		if (typeof vValue === "number" || typeof vValue === "boolean") {
			return String(vValue);
		}
		if (/^\d{4}-\d{2}-\d{2}$/.test(vValue)) {
			return vValue;
		}
		return "'" + String(vValue).replace(/'/g, "''") + "'";
	}

	function functionUrl(sRoot, sName, oArgs) {
		var sArgs = Object.keys(oArgs || {}).map(function (sKey) {
			return sKey + "=" + encodeURIComponent(literal(oArgs[sKey]));
		}).join(",");
		return sRoot + "/" + sName + "(" + sArgs + ")";
	}

	/**
	 * @param {string} sEntitySet e.g. "MyClaims"
	 * @param {string} sId the row's ID
	 * @param {boolean} bActive true for the saved row, false for its draft copy
	 * @returns {string} the entity path, e.g. "MyClaims(ID=…,IsActiveEntity=false)"
	 */
	function draftPath(sEntitySet, sId, bActive) {
		return sEntitySet + "(ID=" + sId + ",IsActiveEntity=" + (bActive ? "true" : "false") + ")";
	}

	// Everything of a claim the pages show, items and mileage included. The receipt
	// itself is left out: it is read separately, only when someone opens it.
	var ITEM_FIELDS = "ID,IsActiveEntity,expenseDate,expenseType_code,destination,reasonForTrip,vatType," +
		"grossAmount,netAmount,vatAmount,originalAmount,originalCurrency,fxRate,fxTargetCurrency," +
		"receiptAttached,receiptFileName,receiptMimeType,notes";
	var MILEAGE_FIELDS = "ID,IsActiveEntity,tripDate,destination,reasonForTrip,engineType,milesCount,ratePerMile,totalAmount";
	var CLAIM_EXPAND = "items($select=" + ITEM_FIELDS + ";$orderby=expenseDate),mileageClaims($select=" +
		MILEAGE_FIELDS + ";$orderby=tripDate)";

	return {

		draftPath: draftPath,

		/* ---------------- My Expenses (/expense) ---------------- */

		/**
		 * The signed-in employee: name, number, site and payroll area, as the expense
		 * service knows them from HRX.
		 * @returns {Promise<object>} { email, fullName, employeeNumber, site, payrollArea }
		 */
		whoAmI: function () {
			return send(EXPENSE_ROOT + "/whoami()");
		},

		/**
		 * The employee's claims, each with its items and mileage. A claim with an open
		 * draft comes back as the draft, so changes not yet saved still show.
		 * @returns {Promise<Array<object>>} the claims, newest period first
		 */
		myClaims: function () {
			return send(EXPENSE_ROOT + "/MyClaims" + query({
				$filter: "(IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null)",
				$expand: CLAIM_EXPAND,
				$orderby: "claimPeriod desc"
			})).then(function (oJson) {
				return oJson.value;
			});
		},

		/**
		 * @param {string} sId the claim
		 * @param {boolean} bActive the saved claim (true) or its draft (false)
		 * @returns {Promise<object>} the claim with items and mileage
		 */
		claim: function (sId, bActive) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sId, bActive) + query({ $expand: CLAIM_EXPAND }));
		},

		/**
		 * Starts a new claim as a draft.
		 * @param {object} oHeader { country, claimPeriod, currency }
		 * @returns {Promise<object>} the new draft claim
		 */
		createClaim: function (oHeader) {
			return send(EXPENSE_ROOT + "/MyClaims", jsonRequest("POST", oHeader));
		},

		/**
		 * Opens a saved claim for editing: makes its draft copy.
		 * @param {string} sId the claim
		 * @returns {Promise<object>} the draft
		 */
		editClaim: function (sId) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sId, true) + "/ExpenseService.draftEdit",
				jsonRequest("POST", { PreserveChanges: true }));
		},

		/**
		 * Saves a draft as the claim (the service recalculates every amount here).
		 * @param {string} sId the claim
		 * @returns {Promise<object>} the saved claim
		 */
		saveClaim: function (sId) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sId, false) + "/ExpenseService.draftActivate",
				jsonRequest("POST", {}));
		},

		/** Throws away a draft's changes (the saved claim, if there is one, stays). */
		discardDraft: function (sId) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sId, false), { method: "DELETE" });
		},

		/** Deletes a saved claim (the service allows it for drafts and returned claims). */
		deleteClaim: function (sId) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sId, true), { method: "DELETE" });
		},

		/**
		 * Sends a saved claim for approval.
		 * @param {string} sId the claim
		 * @returns {Promise<object>} the submitted claim
		 */
		submitClaim: function (sId) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sId, true) + "/ExpenseService.submitClaim",
				jsonRequest("POST", {}));
		},

		updateClaimDraft: function (sId, oChanges) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sId, false), jsonRequest("PATCH", oChanges));
		},

		addItem: function (sClaimId, oItem) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sClaimId, false) + "/items", jsonRequest("POST", oItem));
		},

		updateItem: function (sItemId, oChanges) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaimItems", sItemId, false), jsonRequest("PATCH", oChanges));
		},

		removeItem: function (sItemId) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaimItems", sItemId, false), { method: "DELETE" });
		},

		addMileage: function (sClaimId, oMileage) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sClaimId, false) + "/mileageClaims", jsonRequest("POST", oMileage));
		},

		updateMileage: function (sMileageId, oChanges) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyMileageClaims", sMileageId, false), jsonRequest("PATCH", oChanges));
		},

		removeMileage: function (sMileageId) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyMileageClaims", sMileageId, false), { method: "DELETE" });
		},

		/**
		 * Stores a receipt on a draft item: the file itself, then its name and type.
		 * @param {string} sItemId the draft item
		 * @param {Blob} oFile the receipt (image or PDF)
		 * @param {string} sFileName its name
		 * @returns {Promise} done
		 */
		putReceipt: function (sItemId, oFile, sFileName) {
			var sItemPath = EXPENSE_ROOT + "/" + draftPath("MyClaimItems", sItemId, false);
			var sMimeType = oFile.type || "application/octet-stream";
			return send(sItemPath + "/receipt", {
				method: "PUT",
				headers: { "Content-Type": sMimeType },
				body: oFile
			}).then(function () {
				return send(sItemPath, jsonRequest("PATCH", {
					receiptFileName: sFileName,
					receiptMimeType: sMimeType,
					receiptAttached: true
				}));
			});
		},

		/**
		 * Gives every other item of a draft claim without a receipt a copy of one item's
		 * receipt (one photographed receipt, several lines), so it is uploaded only once.
		 * @param {string} sClaimId the draft claim
		 * @param {string} sSourceItemId the item holding the receipt
		 * @returns {Promise<number>} how many items were given it
		 */
		shareReceipt: function (sClaimId, sSourceItemId) {
			return send(EXPENSE_ROOT + "/" + draftPath("MyClaims", sClaimId, false) + "/ExpenseService.shareReceipt",
				jsonRequest("POST", { sourceItem: sSourceItemId }));
		},

		/**
		 * @param {string} sItemId an item
		 * @param {boolean} bActive the saved item (true) or a draft item (false)
		 * @returns {string} the url its receipt can be opened at
		 */
		myReceiptUrl: function (sItemId, bActive) {
			return EXPENSE_ROOT + "/" + draftPath("MyClaimItems", sItemId, bActive) + "/receipt";
		},

		/**
		 * Reads a photographed receipt with AI: vendor, date, amount, currency (converted
		 * to the claim's currency), type and lines. Writes nothing.
		 * @param {string} sBase64 the image, base64 without the data: prefix
		 * @param {string} sMimeType e.g. "image/jpeg"
		 * @param {string} sCountry the claim's country (UK or IN)
		 * @returns {Promise<object>} the reading (ReceiptDraft)
		 */
		readReceipt: function (sBase64, sMimeType, sCountry) {
			return send(EXPENSE_ROOT + "/extractReceipt", jsonRequest("POST", {
				image: sBase64, mime: sMimeType, country: sCountry, scanInfo: "hrx"
			}));
		},

		/**
		 * Converts a foreign amount at the rate for that day.
		 * @returns {Promise<object>} { convertedAmount, rate, fromCurrency, toCurrency, onDate }
		 */
		convertCurrency: function (fAmount, sFrom, sTo, sDate) {
			return send(functionUrl(EXPENSE_ROOT, "fxPreview", {
				amount: Number(fAmount), fromCurrency: sFrom, toCurrency: sTo, onDate: sDate
			}));
		},

		/**
		 * @param {string} sCountry UK or IN
		 * @returns {Promise<string>} the email of the first approver a claim goes to
		 */
		approverFor: function (sCountry) {
			return send(functionUrl(EXPENSE_ROOT, "approverFor", { country: sCountry })).then(function (oJson) {
				return oJson && oJson.value;
			});
		},

		/**
		 * The lists the claim screen picks from: expense types, tax types and the policy
		 * per country.
		 * @returns {Promise<object>} { types, taxTypes, policies }
		 */
		lookups: function () {
			return Promise.all([
				send(EXPENSE_ROOT + "/ExpenseTypes"),
				send(EXPENSE_ROOT + "/TaxTypes"),
				send(EXPENSE_ROOT + "/Policies")
			]).then(function (aAnswers) {
				return { types: aAnswers[0].value, taxTypes: aAnswers[1].value, policies: aAnswers[2].value };
			});
		},

		/* ---------------- Approval (/approval) ---------------- */

		/** @returns {Promise<Array<object>>} the claims waiting for the user's decision */
		/**
		 * Who decides a claim at a step: the configured approver's full name (the
		 * approval service's approverFor). Readable by every approver, unlike the
		 * approver settings, which are for admins.
		 * @param {string} sCountry UK or IN
		 * @param {number} iLevel 1 (first approver) or 2 (second, UK only)
		 * @returns {Promise<string>} the name, or "" when none is set
		 */
		approverName: function (sCountry, iLevel) {
			return send(functionUrl(APPROVAL_ROOT, "approverFor", { country: sCountry, level: iLevel })).then(function (oJson) {
				return (oJson && oJson.value) || "";
			});
		},

		/** @returns {Promise<object>} the signed-in approver as the approval service sees them */
		approverWhoAmI: function () {
			return send(APPROVAL_ROOT + "/whoami()");
		},

		awaitingDecision: function () {
			return send(APPROVAL_ROOT + "/Approvals" + query({ $orderby: "submittedAt" })).then(function (oJson) {
				return oJson.value;
			});
		},

		/**
		 * @param {string} sId a claim waiting for a decision
		 * @returns {Promise<object>} the claim with its items and mileage
		 */
		approvalClaim: function (sId) {
			return send(APPROVAL_ROOT + "/Approvals(" + sId + ")").then(function (oClaim) {
				var sFilter = "claim_ID eq " + sId;
				return Promise.all([
					send(APPROVAL_ROOT + "/ApprovalItems" + query({ $filter: sFilter, $select: ITEM_FIELDS.replace("IsActiveEntity,", ""), $orderby: "expenseDate" })),
					send(APPROVAL_ROOT + "/ApprovalMileage" + query({ $filter: sFilter, $select: MILEAGE_FIELDS.replace("IsActiveEntity,", ""), $orderby: "tripDate" }))
				]).then(function (aAnswers) {
					oClaim.items = aAnswers[0].value;
					oClaim.mileageClaims = aAnswers[1].value;
					return oClaim;
				});
			});
		},

		/** Approves a claim at the user's level (UK: first then second; India: one). */
		approve: function (sId, sComment) {
			return send(APPROVAL_ROOT + "/Approvals(" + sId + ")/ApprovalService.approve", jsonRequest("POST", { comment: sComment || "" }));
		},

		/** Returns a claim to the employee to rework; the reason is required. */
		returnClaim: function (sId, sReason) {
			return send(APPROVAL_ROOT + "/Approvals(" + sId + ")/ApprovalService.reject", jsonRequest("POST", { comment: sReason }));
		},

		/** @returns {string} the url an approver can open an item's receipt at */
		approvalReceiptUrl: function (sItemId) {
			return APPROVAL_ROOT + "/ApprovalItems(" + sItemId + ")/receipt";
		},

		/**
		 * Every claim that has been submitted, newest first.
		 * @returns {Promise<Array<object>>} the claims
		 */
		history: function () {
			return send(APPROVAL_ROOT + "/ClaimHistory" + query({ $orderby: "submittedAt desc", $top: 500 })).then(function (oJson) {
				return oJson.value;
			});
		},

		/**
		 * A claim's journey: who it was assigned to, every step and its attachments.
		 * @param {string} sClaimNumber e.g. UKEXP12
		 * @returns {Promise<object>} the journey
		 */
		claimJourney: function (sClaimNumber) {
			return send(functionUrl(APPROVAL_ROOT, "claimJourney", { claimNumber: sClaimNumber }));
		},

		/**
		 * The dashboard figures for a period and country.
		 * @returns {Promise<object>} DashStats
		 */
		dashboard: function (sFrom, sTo, sCountry) {
			return send(functionUrl(APPROVAL_ROOT, "dashboardStats", { fromDate: sFrom, toDate: sTo, country: sCountry }));
		},

		/**
		 * A PDF of the claims matching the filters, made by the service.
		 * @param {object} oFilters { scope ("approvals" | "history"), status, country, claimNo, fromDate, toDate }
		 * @returns {Promise<Blob>} the PDF
		 */
		claimsPdf: function (oFilters) {
			return send(functionUrl(APPROVAL_ROOT, "exportClaimsPdf", {
				scope: oFilters.scope || "history",
				status: oFilters.status || null,
				country: oFilters.country || null,
				claimNo: oFilters.claimNo || null,
				fromDate: oFilters.fromDate || null,
				toDate: oFilters.toDate || null
			})).then(function (oJson) {
				// The service answers either with the bytes as a Node buffer,
				// { type: "Buffer", data: [...] }, or base64-encoded (URL-safe or not)
				var vValue = oJson.value;
				var aBytes;
				if (vValue && Array.isArray(vValue.data)) {
					aBytes = new Uint8Array(vValue.data);
				} else {
					var sBase64 = String(vValue).replace(/-/g, "+").replace(/_/g, "/");
					while (sBase64.length % 4) {
						sBase64 += "=";
					}
					var sBinary = atob(sBase64);
					aBytes = new Uint8Array(sBinary.length);
					for (var i = 0; i < sBinary.length; i++) {
						aBytes[i] = sBinary.charCodeAt(i);
					}
				}
				return new Blob([aBytes], { type: "application/pdf" });
			});
		},

		/* ---------------- Settings (/approval, Admin role) ---------------- */

		/** @returns {Promise<Array<object>>} the saved policy per country */
		policies: function () {
			return send(APPROVAL_ROOT + "/Policies" + query({ $filter: "IsActiveEntity eq true", $orderby: "country" })).then(function (oJson) {
				return oJson.value;
			});
		},

		/** @returns {Promise<Array<object>>} the approvers per country */
		approvers: function () {
			return send(APPROVAL_ROOT + "/WorkflowMembers" + query({ $filter: "IsActiveEntity eq true", $orderby: "country" })).then(function (oJson) {
				return oJson.value;
			});
		},

		/**
		 * Saves changes to a policy or an approver row, through a draft as the service
		 * requires: open a draft, change it, save it.
		 * @param {string} sEntitySet "Policies" or "WorkflowMembers"
		 * @param {string} sKeyPredicate e.g. "ID=…" or "country='UK'"
		 * @param {object} oChanges the fields to change
		 * @returns {Promise<object>} the saved row
		 */
		saveSetting: function (sEntitySet, sKeyPredicate, oChanges) {
			var sActive = APPROVAL_ROOT + "/" + sEntitySet + "(" + sKeyPredicate + ",IsActiveEntity=true)";
			var sDraft = APPROVAL_ROOT + "/" + sEntitySet + "(" + sKeyPredicate + ",IsActiveEntity=false)";
			return send(sActive + "/ApprovalService.draftEdit", jsonRequest("POST", { PreserveChanges: true })).then(function () {
				return send(sDraft, jsonRequest("PATCH", oChanges));
			}).then(function () {
				return send(sDraft + "/ApprovalService.draftActivate", jsonRequest("POST", {}));
			}).catch(function (oError) {
				// Leave no draft behind to block the next edit
				return send(sDraft, { method: "DELETE" }).catch(function () {
					return null;
				}).then(function () {
					throw oError;
				});
			});
		},

		/**
		 * The audit log: every submission, decision and settings change, newest first.
		 * @returns {Promise<Array<object>>} the latest 200 entries
		 */
		auditLog: function () {
			return send(APPROVAL_ROOT + "/AuditLogs" + query({ $orderby: "timestamp desc", $top: 200 })).then(function (oJson) {
				return oJson.value;
			});
		},

		/** @returns {Promise<Array<object>>} the employees an approver can be picked from */
		employees: function () {
			return send(APPROVAL_ROOT + "/Employees").then(function (oJson) {
				return oJson.value;
			});
		},

		/**
		 * Whether the signed-in user may approve: the approval list answers only an
		 * Approver.
		 * @returns {Promise<boolean>} true for an approver
		 */
		canApprove: function () {
			return send(APPROVAL_ROOT + "/Approvals/$count").then(function () {
				return true;
			}, function () {
				return false;
			});
		},

		/** @returns {Promise<boolean>} true when the user may change the settings (Admin) */
		canAdminister: function () {
			return send(APPROVAL_ROOT + "/WorkflowMembers/$count").then(function () {
				return true;
			}, function () {
				return false;
			});
		}
	};
});
