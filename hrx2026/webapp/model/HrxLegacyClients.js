sap.ui.define([
	"./Hrx",
	"./HrxServices"
], function (Hrx, HrxServices) {
	"use strict";

	/*
	 * Manage Clients' detail tabs, answered from the HRX service in the shapes the page
	 * was written against (the original supportx and xsodata services). HrxLegacy asks
	 * here for each call; a call is only answered when the HRX service has what it needs
	 * deployed (HrxServices), otherwise it goes to the original services as before.
	 *
	 * HRX keeps software, components, apps and services as names typed on the page, not
	 * codes from a catalogue: the "catalogue" reads below list the names already in use,
	 * as suggestions.
	 */

	var SEVERITIES = ["Very High", "High", "Medium", "Low"];
	var HOURS = "hrs";

	function ok(oPayload) {
		return Object.assign({ msgType: "S", msg: "" }, oPayload);
	}

	function yn(bValue) {
		return bValue ? "Y" : "N";
	}

	function isYes(vValue) {
		return vValue === true || vValue === "Y" || vValue === "1" || vValue === "true";
	}

	// "yyyy-MM-dd", or null for an empty date.
	function day(vDate) {
		return vDate ? String(vDate).slice(0, 10) : null;
	}

	function byClient(sEntitySet, sClientId) {
		return Hrx.list(sEntitySet, { $filter: "Client_ID eq " + sClientId });
	}

	function distinct(aValues) {
		return aValues.filter(function (sValue, iIndex) {
			return sValue && aValues.indexOf(sValue) === iIndex;
		}).sort();
	}

	/* --------------------------------------------------------------- */
	/* support users (supportx/ManageClientUsers.xsjs)                  */
	/* --------------------------------------------------------------- */

	function toSupportUser(oUser) {
		return {
			UserID: oUser.ID,
			FName: oUser.FirstName || "",
			LName: oUser.LastName || "",
			Email: oUser.Email || "",
			Mobile: oUser.Mobile || "",
			IsActive: yn(oUser.IsActive !== false),
			IsAdmin: yn(oUser.IsAdmin === true)
		};
	}

	var SupportUsers = {
		// OrgID is the client's key on this page.
		fetch: function (oParams) {
			return byClient("ClientUsers", oParams.OrgID).then(function (aUsers) {
				return ok({ users: aUsers.map(toSupportUser) });
			});
		},

		"new": function (oBody) {
			return Hrx.create("ClientUsers", {
				Client_ID: oBody.OrgID,
				FirstName: oBody.FName,
				LastName: oBody.LName,
				Email: oBody.Email,
				Mobile: oBody.Mobile || "",
				IsActive: isYes(oBody.IsActive),
				IsAdmin: isYes(oBody.IsAdmin)
			}).then(function (oCreated) {
				return ok({ UserID: oCreated.ID });
			});
		},

		update: function (oBody) {
			return Hrx.update("ClientUsers(" + oBody.UserID + ")", {
				FirstName: oBody.FName,
				LastName: oBody.LName,
				Email: oBody.Email,
				Mobile: oBody.Mobile || "",
				IsActive: isYes(oBody.IsActive),
				IsAdmin: isYes(oBody.IsAdmin)
			}).then(function () {
				return ok({});
			});
		}
	};

	/* --------------------------------------------------------------- */
	/* service levels (supportx/ManageSLA.xsjs)                         */
	/* --------------------------------------------------------------- */

	var ServiceLevels = {
		fetch: function (oParams) {
			return byClient("ClientSLAs", oParams.OrgID).then(function (aSlas) {
				return ok({
					sla: aSlas.sort(function (a, b) {
						return SEVERITIES.indexOf(a.Severity) - SEVERITIES.indexOf(b.Severity);
					}).map(function (oSla) {
						return {
							PriorityID: oSla.Severity,
							PriorityDesc: oSla.Severity,
							ResponseSLA: String(oSla.ResponseHours),
							ResolutionSLA: String(oSla.ResolutionHours),
							UoM: HOURS
						};
					})
				});
			});
		},

		"new": function (oBody) {
			return Hrx.create("ClientSLAs", {
				Client_ID: oBody.OrgID,
				Severity: oBody.PriorityID,
				ResponseHours: parseFloat(oBody.ResponseSLA) || 0,
				ResolutionHours: parseFloat(oBody.ResolutionSLA) || 0
			}).then(function () {
				return ok({});
			});
		},

		// The page edits a service level by its severity, which it does not let you change.
		update: function (oBody) {
			return Hrx.list("ClientSLAs", {
				$filter: "Client_ID eq " + oBody.OrgID + " and Severity eq " + Hrx.literal(oBody.PriorityID)
			}).then(function (aSlas) {
				if (!aSlas.length) {
					throw new Error("That service level no longer exists.");
				}
				return Hrx.update("ClientSLAs(" + aSlas[0].ID + ")", {
					ResponseHours: parseFloat(oBody.ResponseSLA) || 0,
					ResolutionHours: parseFloat(oBody.ResolutionSLA) || 0
				});
			}).then(function () {
				return ok({});
			});
		}
	};

	/* --------------------------------------------------------------- */
	/* licensed components (hrx/manageClientApps.xsjs, LicensedAppsData) */
	/* --------------------------------------------------------------- */

	// "NA" is what the page sends for "no component / sub-component".
	function nameOrEmpty(sValue) {
		return !sValue || sValue === "NA" ? "" : sValue;
	}

	function componentBody(oBody) {
		return {
			Software: oBody.Software,
			Component: nameOrEmpty(oBody.Component),
			SubComponent: nameOrEmpty(oBody.SubComponent),
			ValidFrom: day(oBody.ValidFrom),
			ValidTill: day(oBody.ValidTill),
			IsSupported: isYes(oBody.IsSupported),
			SystemNo: oBody.SystemNo || "",
			SAPVersion: oBody.SAPVersion || "",
			InstallDate: day(oBody.InstallDate),
			ObjectCost: String(oBody.ObjectCost || ""),
			SupportCost: String(oBody.SupportCost || ""),
			ShowWarning: isYes(oBody.ShowWarning),
			WarningMessage: oBody.WarningMessage || "",
			HardMessage: oBody.HardMessage || "",
			IsCloudCustomer: isYes(oBody.IsCloudCustomer)
		};
	}

	function toLicensedApp(oComponent) {
		return {
			SoftwareRecID: oComponent.ID,
			ClientKey: oComponent.Client_ID,
			Software: oComponent.Software || "",
			Component: oComponent.Component || "",
			SubComponent: oComponent.SubComponent || "",
			AppName: oComponent.Software || "",
			ComponentName: oComponent.Component || "",
			SubComponentName: oComponent.SubComponent || "",
			ValidFrom: oComponent.ValidFrom,
			ValidTill: oComponent.ValidTill,
			IsSupported: yn(oComponent.IsSupported),
			SystemNo: oComponent.SystemNo || "",
			SAPVersion: oComponent.SAPVersion || "",
			InstallDate: oComponent.InstallDate,
			ObjectCost: oComponent.ObjectCost || "",
			SupportCost: oComponent.SupportCost || "",
			ShowWarning: oComponent.ShowWarning ? "1" : "0",
			WarningMessage: oComponent.WarningMessage || "",
			// A hard message blocks the client's use of the component: shown as an error row.
			ShowError: oComponent.HardMessage ? "1" : "0",
			HardMessage: oComponent.HardMessage || "",
			IsCloudCustomer: yn(oComponent.IsCloudCustomer)
		};
	}

	var LicensedApps = {
		"new": function (oBody) {
			return Hrx.create("ClientComponents", Object.assign({ Client_ID: oBody.ClientKey }, componentBody(oBody))).then(function () {
				return ok({});
			});
		},

		update: function (oBody) {
			return Hrx.update("ClientComponents(" + oBody.SoftwareRecID + ")", componentBody(oBody)).then(function () {
				return ok({});
			});
		},

		"delete": function (oBody) {
			return Hrx.remove("ClientComponents(" + oBody.SoftwareRecID + ")").then(function () {
				return ok({});
			});
		}
	};

	/* --------------------------------------------------------------- */
	/* application services (ClientAppServiceView, ClientAppServices)   */
	/* --------------------------------------------------------------- */

	var ApplicationServices = {
		"new": function (oBody) {
			return Hrx.create("ClientApplications", {
				Client_ID: oBody.ClientKey,
				AppName: oBody.AppID,
				ServiceName: oBody.ServiceID,
				ValidFrom: day(oBody.ValidFrom),
				ValidTill: day(oBody.ValidTill),
				DeployedVersion: oBody.DeployedVersion || ""
			}).then(function () {
				return ok({});
			});
		}
	};

	/* --------------------------------------------------------------- */
	/* reads by entity set                                              */
	/* --------------------------------------------------------------- */

	function clientKeyFilter(aFilters) {
		var oFilter = (aFilters || []).filter(function (oCandidate) {
			return (oCandidate.sPath || (oCandidate.getPath && oCandidate.getPath())) === "ClientKey";
		})[0];
		return oFilter ? (oFilter.oValue1 !== undefined ? oFilter.oValue1 : oFilter.getValue1()) : null;
	}

	var ENTITY_SETS = {
		PRIORITY: {
			needs: "ClientSLAs",
			read: function () {
				return Promise.resolve(SEVERITIES.map(function (sSeverity) {
					return { PriorityID: sSeverity, PriorityDesc: sSeverity };
				}));
			}
		},
		Softwares: {
			needs: "ClientComponents",
			read: function () {
				return Hrx.list("ClientComponents", { $select: "Software" }).then(function (aRows) {
					return distinct(aRows.map(function (oRow) { return oRow.Software; })).map(function (sName) {
						return { AppID: sName, AppName: sName, AppType: "" };
					});
				});
			}
		},
		Components: {
			needs: "ClientComponents",
			read: function () {
				return Hrx.list("ClientComponents", { $select: "Software,Component" }).then(function (aRows) {
					var aKeys = distinct(aRows.filter(function (oRow) { return oRow.Component; }).map(function (oRow) { return oRow.Software + "\u0000" + oRow.Component; }));
					return aKeys.map(function (sKey) {
						var aParts = sKey.split("\u0000");
						return { AppID: aParts[0], ComponentID: aParts[1], ComponentName: aParts[1] };
					});
				});
			}
		},
		SubComponents: {
			needs: "ClientComponents",
			read: function () {
				return Hrx.list("ClientComponents", { $select: "Software,Component,SubComponent" }).then(function (aRows) {
					var aKeys = distinct(aRows.filter(function (oRow) { return oRow.SubComponent; }).map(function (oRow) {
						return oRow.Software + "\u0000" + oRow.Component + "\u0000" + oRow.SubComponent;
					}));
					return aKeys.map(function (sKey) {
						var aParts = sKey.split("\u0000");
						return { AppID: aParts[0], ComponentID: aParts[1], SubComponentID: aParts[2], SubComponentName: aParts[2] };
					});
				});
			}
		},
		AppMaster: {
			needs: "ClientApplications",
			read: function () {
				return Hrx.list("ClientApplications", { $select: "AppName" }).then(function (aRows) {
					return distinct(aRows.map(function (oRow) { return oRow.AppName; })).map(function (sName) {
						return { AppID: sName, AppDesc: sName, AppType: "" };
					});
				});
			}
		},
		BTPServices: {
			needs: "ClientApplications",
			read: function () {
				return Hrx.list("ClientApplications", { $select: "ServiceName" }).then(function (aRows) {
					return distinct(aRows.map(function (oRow) { return oRow.ServiceName; })).map(function (sName) {
						return { ServiceID: sName, ServiceDesc: sName };
					});
				});
			}
		},
		LicensedAppsData: {
			needs: "ClientComponents",
			read: function (mParameters) {
				var sClientKey = clientKeyFilter(mParameters && mParameters.filters);
				return (sClientKey ? byClient("ClientComponents", sClientKey) : Hrx.list("ClientComponents")).then(function (aRows) {
					return aRows.map(toLicensedApp);
				});
			}
		},
		ClientAppServiceView: {
			needs: "ClientApplications",
			read: function (mParameters) {
				var sClientKey = clientKeyFilter(mParameters && mParameters.filters);
				return (sClientKey ? byClient("ClientApplications", sClientKey) : Hrx.list("ClientApplications")).then(function (aRows) {
					return aRows.map(function (oRow) {
						return {
							ClientKey: oRow.Client_ID,
							AppID: oRow.AppName || "",
							ServiceID: oRow.ServiceName || "",
							ServiceDesc: oRow.ServiceName || "",
							ValidFrom: oRow.ValidFrom,
							ValidTill: oRow.ValidTill,
							DeployedVersion: oRow.DeployedVersion || ""
						};
					});
				});
			}
		}
	};

	var SERVICES = {
		"supportx/ManageClientUsers.xsjs": { needs: "ClientUsers", commands: SupportUsers },
		"supportx/ManageSLA.xsjs": { needs: "ClientSLAs", commands: ServiceLevels },
		"hrx/manageClientApps.xsjs": { needs: "ClientComponents", commands: LicensedApps },
		"hrx/manageClientServices.xsjs": { needs: "ClientApplications", commands: ApplicationServices }
	};

	return {
		/**
		 * @param {string} sServicePath e.g. "supportx/ManageSLA.xsjs"
		 * @returns {object|null} its commands, when the HRX service can answer them
		 */
		service: function (sServicePath) {
			var oEntry = SERVICES[sServicePath];
			return oEntry && HrxServices.has(oEntry.needs) ? oEntry.commands : null;
		},

		/**
		 * @param {string} sEntitySet e.g. "LicensedAppsData"
		 * @returns {function|null} its read(mParameters), when the HRX service can answer it
		 */
		entitySet: function (sEntitySet) {
			var oEntry = ENTITY_SETS[sEntitySet];
			return oEntry && HrxServices.has(oEntry.needs) ? oEntry.read : null;
		}
	};
});
