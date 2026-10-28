sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Fragment",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageToast",
	"sap/m/MessageBox",
	"sap/m/Dialog",
	"sap/m/Button",
	"sap/m/Text",
	"../model/Backend",
	"../model/CurrentUser",
	"../model/formatter",
	"../model/TeamLeave",
	"./BookLeave",
	"../model/Toast"
], function (Controller, Fragment, JSONModel, Filter, FilterOperator, MessageToast, MessageBox, Dialog, Button, Text, Backend,
	CurrentUser, formatter, TeamLeave, BookLeave, Toast) {
	"use strict";

	// Root path of the backend services. Both the local dev proxy (ui5.yaml) and the
	// deployed approuter (xs-app.json) expose the HANA XS services below /services.
	var SERVICE_ROOT = Backend.SERVICE_ROOT;

	var USERS_SERVICE = SERVICE_ROOT + "/master/manageUsers.xsjs";

	// The filter's "All locations" choice (an empty Location means the same)
	var ALL_SITES = "__all";
	var LEAVE_SERVICE = SERVICE_ROOT + "/hrx/leaveReqs.xsjs";
	var LEAVE_APPROVALS_SERVICE = SERVICE_ROOT + "/hrx/leaveApprovals.xsjs";

	// Everything the list shows. Pic is a link to the picture in the document
	// service (not the picture itself), so the list can show it beside each name;
	// PicB is not needed.
	var LIST_FIELDS = [
		"ID", "UserID", "EmpID", "OrgID", "FName", "LName", "Email", "Mobile", "Pic",
		"UserTypeKey", "BaseSiteKey", "ManagerID", "IsActive", "TargetUtilization",
		"TargetHrsPerWeek", "AnnualLeaveQuota", "BonusPercent", "PensionRate",
		"Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"
	];

	var DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

	var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

	return Controller.extend("bsx.hrx.hrx2026.controller.ManageResources", Object.assign({}, BookLeave, {

		formatter: formatter,

		/* =========================================================== */
		/* lifecycle                                                   */
		/* =========================================================== */

		onInit: function () {
			this._sOrgId = this._resolveOrgId();

			this.setModel(new JSONModel({
				fullScreen: false,
				listBusy: true,
				detailBusy: false,
				leaveBusy: false,
				saving: false,
				title: this.getText("mrListTitle"),
				searchQuery: "",
				selectedId: null,
				selectedTab: "info",
				filter: this._defaultFilter(),
				filterDraft: this._defaultFilter()
			}), "mrView");

			this.setModel(new JSONModel({
				allResources: [],
				resources: [],
				managers: [],
				sites: [],
				userTypes: []
			}), "mr");

			this.setModel(new JSONModel({}), "mrDetail");
			this.setModel(new JSONModel(this._emptyLeaveData()), "mrLeave");
			this.setModel(new JSONModel(this._emptyNewResource()), "mrNew");

			// The value helps never change, so they are fetched once. The resource list is
			// (re)loaded per entry into the app, see _onRouteMatched.
			this._pLookupsLoaded = this._loadLookups();

			this.getOwnerComponent().getRouter().getRoute("resources")
				.attachPatternMatched(this._onRouteMatched, this);
		},

		/**
		 * The view is instantiated once and then reused, so entering the app has to reset
		 * it explicitly: the user always lands on the resource list rather than on the
		 * resource they happened to have open the last time.
		 */
		_onRouteMatched: function () {
			this._resetToList();
			this._pLookupsLoaded.then(this._loadResources.bind(this));
		},

		/**
		 * Returns the view to its initial state: list only, nothing selected, no search
		 * term and the default filters.
		 */
		_resetToList: function () {
			var oViewModel = this.getModel("mrView");

			oViewModel.setProperty("/searchQuery", "");
			oViewModel.setProperty("/filter", this._defaultFilter());
			oViewModel.setProperty("/filterDraft", this._defaultFilter());

			this._closeDetail();
		},

		/* =========================================================== */
		/* data loading                                                */
		/* =========================================================== */

		/**
		 * Loads the sites and user type value helps from the OData service.
		 * @returns {Promise} resolved once both value helps are in the model
		 */
		_loadLookups: function () {
			var oModel = this.getModel("mr");

			var pSites = this._read("/sites", {
				filters: [new Filter("OrgID", FilterOperator.EQ, this._sOrgId)]
			}).then(function (oData) {
				var aSites = (oData.results || [])
					.filter(function (oSite) {
						return !!oSite.SiteID;
					})
					.map(function (oSite) {
						return {
							SiteID: oSite.SiteID,
							SiteLabel: oSite.SiteDesc || oSite.SiteLocation || oSite.SiteID,
							SiteLocation: oSite.SiteLocation || ""
						};
					})
					.sort(function (a, b) {
						return a.SiteLabel.localeCompare(b.SiteLabel);
					});

				this._mSiteNames = aSites.reduce(function (mNames, oSite) {
					mNames[oSite.SiteID] = oSite.SiteLabel;
					return mNames;
				}, {});

				oModel.setProperty("/sites", aSites);
				// The filter's Location list starts with All, as its other fields do
				oModel.setProperty("/siteFilterOptions", [{
					SiteID: ALL_SITES,
					SiteLabel: this.getText("mrFilterAllLocations"),
					SiteLocation: ""
				}].concat(aSites));
			}.bind(this));

			var pUserTypes = this._read("/UserTypes", {
				filters: [new Filter("OrgID", FilterOperator.EQ, this._sOrgId)]
			}).then(function (oData) {
				oModel.setProperty("/userTypes", (oData.results || []).map(function (oType) {
					return {
						UserTypeKey: oType.UserTypeKey,
						UserTypeDesc: oType.UserTypeDesc
					};
				}).sort(function (a, b) {
					return a.UserTypeDesc.localeCompare(b.UserTypeDesc);
				}));
			});

			return Promise.all([pSites, pUserTypes]).catch(function (oError) {
				this._showError("mrErrorLookups", oError);
			}.bind(this));
		},

		/**
		 * Reads every resource of the organisation and applies the current list filters.
		 * @returns {Promise} resolved once the list is filled
		 */
		_loadResources: function () {
			var oViewModel = this.getModel("mrView");
			oViewModel.setProperty("/listBusy", true);

			return this._read("/Resources", {
				urlParameters: { "$select": LIST_FIELDS.join(",") },
				filters: [new Filter("OrgID", FilterOperator.EQ, this._sOrgId)]
			}).then(function (oData) {
				var aResources = (oData.results || []).map(this._decorateResource, this);
				var oModel = this.getModel("mr");

				oModel.setProperty("/allResources", aResources);
				oModel.setProperty("/managers", aResources.filter(function (oResource) {
					return oResource.IsActive === "Y";
				}).sort(this._byName));

				this._applyListFilters();
				oViewModel.setProperty("/listBusy", false);
			}.bind(this)).catch(function (oError) {
				oViewModel.setProperty("/listBusy", false);
				this._showError("mrErrorResources", oError);
			}.bind(this));
		},

		/**
		 * Adds the display-only fields the list needs on top of the raw entity.
		 * @param {object} oResource resource entity as returned by the service
		 * @returns {object} the enriched resource
		 */
		_decorateResource: function (oResource) {
			var oCopy = Object.assign({}, oResource);
			delete oCopy.__metadata;
			oCopy.SiteName = this._siteName(oCopy.BaseSiteKey);
			oCopy.FullName = ((oCopy.FName || "") + " " + (oCopy.LName || "")).trim();
			return oCopy;
		},

		_siteName: function (sSiteKey) {
			return (this._mSiteNames && this._mSiteNames[sSiteKey]) || sSiteKey || "";
		},

		_byName: function (a, b) {
			return (a.FullName || "").localeCompare(b.FullName || "");
		},

		/**
		 * Applies search term, user type, active state and site filters on the resource
		 * list and refreshes the list header count.
		 */
		_applyListFilters: function () {
			var oViewModel = this.getModel("mrView");
			var oFilter = oViewModel.getProperty("/filter");
			var sQuery = (oViewModel.getProperty("/searchQuery") || "").trim().toLowerCase();

			var aFiltered = (this.getModel("mr").getProperty("/allResources") || []).filter(function (oResource) {
				if (oFilter.userType !== "A" && oResource.UserTypeKey !== oFilter.userType) {
					return false;
				}
				if (oFilter.active !== "A" && (oResource.IsActive || "N") !== oFilter.active) {
					return false;
				}
				if (oFilter.site && oFilter.site !== ALL_SITES && oResource.BaseSiteKey !== oFilter.site) {
					return false;
				}
				if (sQuery) {
					var sHaystack = [
						oResource.FullName, oResource.Email, oResource.SiteName, oResource.Mobile
					].join(" ").toLowerCase();
					if (sHaystack.indexOf(sQuery) === -1) {
						return false;
					}
				}
				return true;
			}).sort(this._byName);

			this.getModel("mr").setProperty("/resources", aFiltered);
			oViewModel.setProperty("/title", this.getText("mrListTitleCount", [aFiltered.length]));
		},

		/**
		 * Reads the complete resource (including the picture) and shows it in the detail column.
		 * @param {string} sEmpId the EmpID of the resource
		 */
		_showResource: function (sEmpId) {
			var oViewModel = this.getModel("mrView");

			oViewModel.setProperty("/selectedId", sEmpId);
			oViewModel.setProperty("/selectedTab", "info");
			oViewModel.setProperty("/detailBusy", true);
			this.getModel("mrLeave").setData(this._emptyLeaveData());

			return this._read(Backend.keyPath("Resources", { EmpID: sEmpId })).then(function (oResource) {
				this.getModel("mrDetail").setData(this._toDetail(oResource));
				oViewModel.setProperty("/detailBusy", false);
				this._resetPictureUploader();
				this._loadLeaves(oResource.Email);
			}.bind(this)).catch(function (oError) {
				oViewModel.setProperty("/detailBusy", false);
				this._closeDetail();
				this._showError("mrErrorResourceDetail", oError);
			}.bind(this));
		},

		/**
		 * Turns the raw entity into the editable shape the detail form is bound against.
		 * @param {object} oResource the resource entity
		 * @returns {object} the editable detail object
		 */
		_toDetail: function (oResource) {
			var oDetail = {
				ID: oResource.ID,
				UserID: oResource.UserID,
				EmpID: oResource.EmpID,
				OrgID: oResource.OrgID || this._sOrgId,
				FName: oResource.FName || "",
				LName: oResource.LName || "",
				JobTitle: oResource.JobTitle || "",
				Email: oResource.Email || "",
				Mobile: oResource.Mobile || "",
				UserTypeKey: oResource.UserTypeKey || "",
				BaseSiteKey: oResource.BaseSiteKey || "",
				ManagerID: oResource.ManagerID || "",
				Pic: oResource.Pic || "",
				PicB: oResource.PicB || "",
				NewPic: "",
				NewPicName: "",
				IsActive: oResource.IsActive || "N",
				Active: oResource.IsActive === "Y",
				TargetUtilization: this._toNumber(oResource.TargetUtilization),
				TargetHrsPerWeek: oResource.TargetHrsPerWeek || "",
				AnnualLeaveQuota: this._toNumber(oResource.AnnualLeaveQuota),
				BonusPercent: this._toNumber(oResource.BonusPercent),
				PensionRate: this._toNumber(oResource.PensionRate),
				SiteName: this._siteName(oResource.BaseSiteKey),
				FullName: ((oResource.FName || "") + " " + (oResource.LName || "")).trim(),
				days: {}
			};

			DAYS.forEach(function (sDay) {
				oDetail.days[sDay] = oResource[sDay] === "Y";
			});

			return oDetail;
		},

		/**
		 * Fetches quota, taken days and the individual leave records of a resource.
		 * @param {string} sEmail the resource's email - the key used by leaveReqs.xsjs
		 */
		_loadLeaves: function (sEmail) {
			var oViewModel = this.getModel("mrView");

			if (!sEmail) {
				this.getModel("mrLeave").setData(this._emptyLeaveData());
				return Promise.resolve();
			}

			oViewModel.setProperty("/leaveBusy", true);

			return this._getJson(LEAVE_SERVICE + "?cmd=fetchUser&" + new URLSearchParams({
				Email: sEmail,
				OrgID: this._sOrgId
			}).toString()).then(function (oData) {
				this.getModel("mrLeave").setData({
					loaded: true,
					user: oData.user || {},
					availedLeaves: oData.availedLeaves || [],
					requests: this._leaveRequests(oData.availedLeaves || []),
					bankHolidays: oData.bankHolidays || [],
					analyticsData: oData.analyticsData || []
				});
				oViewModel.setProperty("/leaveBusy", false);
			}.bind(this)).catch(function (oError) {
				oViewModel.setProperty("/leaveBusy", false);
				this.getModel("mrLeave").setData(this._emptyLeaveData());
				Toast.error(this.getText("mrErrorLeaves") + " " + this._errorText(oError));
			}.bind(this));
		},

		/**
		 * Gathers the resource's leave days into requests, one row each, as My Leave
		 * and Team Calendar show them. Deciding a request decides all its days in one
		 * call, so the employee gets one email for it rather than one per day.
		 * @param {Array<object>} aDays fetchUser's availedLeaves, one entry per day
		 * @returns {Array<object>} requests, newest first: ids, DisplayDate (the range),
		 * DaysText, LeaveType, Absence, Status and StatusID
		 */
		_leaveRequests: function (aDays) {
			var mGroups = {};
			var aOrder = [];

			aDays.forEach(function (oDay) {
				var sKey = (oDay.LeaveGrpID || oDay.LeaveID) + "|" + oDay.StatusID;
				if (!mGroups[sKey]) {
					mGroups[sKey] = { days: [] };
					aOrder.push(sKey);
				}
				mGroups[sKey].days.push(oDay);
			});

			return aOrder.map(function (sKey) {
				var aGroup = mGroups[sKey].days.slice().sort(function (a, b) {
					return a.Date.localeCompare(b.Date);
				});
				var oFirst = aGroup[0];
				var fDays = aGroup.reduce(function (fTotal, oDay) {
					return fTotal + (oDay.Absence === "Full Day" ? 1 : 0.5);
				}, 0);
				var aAbsences = aGroup.map(function (oDay) {
					return oDay.Absence;
				}).filter(function (sAbsence, iIndex, aAll) {
					return aAll.indexOf(sAbsence) === iIndex;
				});
				// One leave row (LeaveID) can cover several days: decide each once
				var aIds = aGroup.map(function (oDay) {
					return oDay.LeaveID;
				}).filter(function (sId, iIndex, aAll) {
					return aAll.indexOf(sId) === iIndex;
				});

				return {
					ids: aIds,
					from: oFirst.Date,
					DisplayDate: TeamLeave.rangeLabel(oFirst.Date, aGroup[aGroup.length - 1].Date),
					DaysText: this.getText(fDays === 1 ? "lmOneDay" : "lmDays", [fDays]),
					LeaveType: oFirst.LeaveType,
					Absence: aAbsences.length === 1 ? aAbsences[0] : this.getText("mrLeaveMixed"),
					Status: oFirst.Status,
					StatusID: oFirst.StatusID
				};
			}, this).sort(function (a, b) {
				return b.from.localeCompare(a.from);
			});
		},

		/* =========================================================== */
		/* leave: booking and decisions                                */
		/* =========================================================== */

		/**
		 * Opens the booking dialog for the resource on screen. Leave types are read
		 * once, the first time it is needed.
		 */
		/**
		 * Books leave for the resource on screen (see BookLeave).
		 */
		onOpenBookLeave: function () {
			var oDetail = this.getModel("mrDetail").getData();
			this.openBookLeave({
				EmpID: oDetail.EmpID,
				EmpName: oDetail.FullName,
				EmpEmail: oDetail.Email,
				SiteID: oDetail.BaseSiteKey
			});
		},

		/**
		 * Called by BookLeave once the leave is saved.
		 * @param {object} oForm what was booked
		 * @returns {Promise} the resource's leave, read again
		 */
		_afterBookLeave: function (oForm) {
			return this._loadLeaves(oForm.EmpEmail);
		},

		onApproveLeave: function (oEvent) {
			var oLeave = oEvent.getSource().getBindingContext("mrLeave").getObject();
			this._decideLeave(oLeave, "APR", "");
		},

		/**
		 * Asks before a request is declined, with room for a note to the employee
		 * (the design's "Decline leave request" modal).
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onRejectLeave: function (oEvent) {
			var oLeave = oEvent.getSource().getBindingContext("mrLeave").getObject();
			var oDetail = this.getModel("mrDetail").getData();

			this.setModel(new JSONModel({
				leave: oLeave,
				summary: this.getText("mrDeclineSummary", [
					oDetail.FullName, oLeave.DisplayDate, oLeave.LeaveType, oLeave.Absence
				]),
				note: ""
			}), "mrDecline");

			this._openDialog("_pDeclineDialog", "bsx.hrx.hrx2026.fragment.ResourceDeclineLeaveDialog");
		},

		onConfirmDeclineLeave: function () {
			var oDecline = this.getModel("mrDecline").getData();
			this._closeDialog("_pDeclineDialog");
			this._decideLeave(oDecline.leave, "REJ", oDecline.note || "");
		},

		onCancelDeclineLeave: function () {
			this._closeDialog("_pDeclineDialog");
		},

		/**
		 * Approves or rejects a request, every day of it in one call (one email).
		 * @param {object} oLeave the request (from mrLeave>/requests)
		 * @param {string} sStatus "APR" or "REJ"
		 * @param {string} sNote the approver's note to the employee, may be empty
		 */
		_decideLeave: function (oLeave, sStatus, sNote) {
			var oDetail = this.getModel("mrDetail").getData();
			var oProfile = CurrentUser.get() || {};

			this.getModel("mrView").setProperty("/leaveBusy", true);

			this._postJson(LEAVE_APPROVALS_SERVICE + "?cmd=action", {
				LeaveReqSet: oLeave.ids.map(function (sLeaveId) {
					return {
						LeaveID: sLeaveId,
						RequesterID: oDetail.EmpID,
						RequesterName: oDetail.FullName,
						RequesterEmail: oDetail.Email,
						Status: sStatus,
						OrgID: this._sOrgId,
						ApprovedOn: this._isoDate(new Date()),
						ApprovedBy: oProfile.empID || "",
						ApproverName: oProfile.name || "",
						ApproverEmail: oProfile.email || "",
						ApproverComments: sNote
					};
				}, this)
			}).then(function () {
				MessageToast.show(this.getText(sStatus === "APR" ? "mrLeaveApproved" : "mrLeaveRejected",
					[oLeave.DisplayDate]));
				return this._loadLeaves(oDetail.Email);
			}.bind(this)).catch(function (oError) {
				this.getModel("mrView").setProperty("/leaveBusy", false);
				this._showError("mrErrorDecideLeave", oError);
			}.bind(this));
		},

		_isoDate: function (oDate) {
			return oDate.getFullYear() + "-" + String(oDate.getMonth() + 1).padStart(2, "0") + "-" +
				String(oDate.getDate()).padStart(2, "0");
		},

		/* =========================================================== */
		/* list events                                                 */
		/* =========================================================== */

		onSearch: function () {
			this._applyListFilters();
		},

		onRefresh: function () {
			var sSelectedId = this.getModel("mrView").getProperty("/selectedId");
			this._loadResources().then(function () {
				if (sSelectedId) {
					this._showResource(sSelectedId);
				}
			}.bind(this));
		},

		onResourcePress: function (oEvent) {
			var oContext = oEvent.getSource().getBindingContext("mr");
			if (oContext) {
				this._showResource(oContext.getProperty("EmpID"));
			}
		},

		onResourceSelect: function (oEvent) {
			var oItem = oEvent.getParameter("listItem");
			var oContext = oItem && oItem.getBindingContext("mr");
			if (oContext) {
				this._showResource(oContext.getProperty("EmpID"));
			}
		},

		/* =========================================================== */
		/* detail events                                               */
		/* =========================================================== */

		onCloseDetail: function () {
			this._closeDetail();
		},

		_closeDetail: function () {
			var oViewModel = this.getModel("mrView");
			oViewModel.setProperty("/fullScreen", false);
			oViewModel.setProperty("/selectedId", null);
			oViewModel.setProperty("/selectedTab", "info");
			this.getModel("mrDetail").setData({});
			this.getModel("mrLeave").setData(this._emptyLeaveData());
		},

		onToggleFullScreen: function () {
			var oViewModel = this.getModel("mrView");
			var bFullScreen = !oViewModel.getProperty("/fullScreen");
			oViewModel.setProperty("/fullScreen", bFullScreen);
		},

		onPictureChange: function (oEvent) {
			var aFiles = oEvent.getParameter("files");
			var oFile = aFiles && aFiles[0];
			if (!oFile) {
				return;
			}

			var oDetailModel = this.getModel("mrDetail");
			var oReader = new FileReader();
			oDetailModel.setProperty("/NewPicName", oFile.name);
			oReader.onload = function (oLoadEvent) {
				oDetailModel.setProperty("/NewPic", oLoadEvent.target.result);
			};
			oReader.readAsDataURL(oFile);
		},

		onPictureTypeMismatch: function (oEvent) {
			Toast.error(this.getText("mrErrorFileType", [oEvent.getParameter("fileType")]));
		},

		onRemovePicture: function () {
			this.getModel("mrDetail").setProperty("/NewPic", "");
			this.getModel("mrDetail").setProperty("/NewPicName", "");
			this.getModel("mrDetail").setProperty("/Pic", "");
			this._resetPictureUploader();
		},

		_resetPictureUploader: function () {
			var oUploader = this.byId("resourcePictureUploader");
			if (oUploader) {
				oUploader.setValue("");
			}
		},

		/**
		 * Persists the edited resource through manageUsers.xsjs.
		 */
		onSave: function () {
			var oDetail = this.getModel("mrDetail").getData();

			if (!oDetail.EmpID) {
				return;
			}
			// Last name is not enforced here: existing records legitimately carry a single
			// name, and blocking them would make those resources uneditable.
			if (!oDetail.FName || !oDetail.BaseSiteKey || !oDetail.UserTypeKey) {
				MessageBox.error(this.getText("mrErrorDetailIncomplete"));
				return;
			}

			var oPayload = this._toUpdatePayload(oDetail);

			this.getModel("mrView").setProperty("/saving", true);

			this._postJson(USERS_SERVICE + "?cmd=update&visitorx=", oPayload).then(function (oResult) {
				this.getModel("mrView").setProperty("/saving", false);
				MessageToast.show(oResult.msg || this.getText("mrSaved"));
				// Every page that shows this person shows their picture
				this.getOwnerComponent().reloadPictures();
				return this._loadResources().then(function () {
					this._updateOwnPicture(oDetail.EmpID);
					return this._showResource(oDetail.EmpID);
				}.bind(this));
			}.bind(this)).catch(function (oError) {
				this.getModel("mrView").setProperty("/saving", false);
				this._showError("mrErrorSave", oError);
			}.bind(this));
		},

		/**
		 * When the resource just saved is the signed-in user, shows their (possibly new)
		 * picture in the side rail and profile straight away.
		 * @param {string} sEmpId the saved resource's employee ID
		 */
		_updateOwnPicture: function (sEmpId) {
			var oAppModel = this.getOwnerComponent().getModel("app");
			if (!sEmpId || oAppModel.getProperty("/user/empID") !== sEmpId) {
				return;
			}
			var oSaved = (this.getModel("mr").getProperty("/allResources") || []).filter(function (oResource) {
				return oResource.EmpID === sEmpId;
			})[0];
			oAppModel.setProperty("/user/pic", (oSaved && oSaved.Pic) || "");
		},

		/**
		 * The body manageUsers.xsjs expects to update a resource.
		 * @param {object} oDetail the detail object (see _toDetail)
		 * @returns {object} the update payload
		 */
		_toUpdatePayload: function (oDetail) {
			var oPayload = {
				ID: oDetail.ID,
				UserID: oDetail.UserID,
				EmpID: oDetail.EmpID,
				OrgID: oDetail.OrgID,
				BaseSiteKey: oDetail.BaseSiteKey,
				FName: oDetail.FName,
				LName: oDetail.LName,
				JobTitle: oDetail.JobTitle || "",
				ManagerID: oDetail.ManagerID || "",
				Mobile: oDetail.Mobile || "",
				Email: oDetail.Email,
				Pic: oDetail.NewPic || oDetail.Pic || "",
				PicB: oDetail.PicB || "",
				IsActive: oDetail.Active ? "Y" : "N",
				UserTypeKey: oDetail.UserTypeKey,
				HostID: "",
				VehRegNo: "",
				AnnualLeaveQuota: String(oDetail.AnnualLeaveQuota || 0),
				TargetUtilization: String(oDetail.TargetUtilization || 0),
				TargetHrsPerWeek: oDetail.TargetHrsPerWeek || "",
				BonusPercent: this._toNumber(oDetail.BonusPercent),
				PensionRate: this._toNumber(oDetail.PensionRate)
			};

			DAYS.forEach(function (sDay) {
				oPayload[sDay] = oDetail.days[sDay] ? "Y" : "N";
			});

			return oPayload;
		},

		/**
		 * Makes the selected resource active or inactive as soon as the switch is
		 * flipped, without saving anything else on the form. The switch goes back if
		 * the change cannot be saved.
		 * @param {sap.ui.base.Event} oEvent the switch's change event
		 */
		onActiveChange: function (oEvent) {
			this._setActive(oEvent.getParameter("state"));
		},

		/**
		 * Makes the selected resource active or inactive, and nothing else.
		 * @param {boolean} bActive the new state
		 * @returns {Promise} settles once saved, or the switch has gone back
		 */
		_setActive: function (bActive) {
			var oDetailModel = this.getModel("mrDetail");
			var oDetail = oDetailModel.getData();
			if (!oDetail.EmpID) {
				return Promise.resolve();
			}

			this.getModel("mrView").setProperty("/saving", true);
			oDetailModel.setProperty("/Active", bActive);

			return this._postJson(USERS_SERVICE + "?cmd=setActive", {
				EmpID: oDetail.UserID,
				IsActive: bActive ? "Y" : "N"
			}).then(function () {
				this.getModel("mrView").setProperty("/saving", false);
				oDetailModel.setProperty("/IsActive", bActive ? "Y" : "N");
				MessageToast.show(this.getText(bActive ? "mrSetActive" : "mrSetInactive", [oDetail.FullName]));
				return this._loadResources();
			}.bind(this)).catch(function (oError) {
				this.getModel("mrView").setProperty("/saving", false);
				oDetailModel.setProperty("/Active", !bActive);
				this._showError("mrErrorActive", oError);
			}.bind(this));
		},

		/**
		 * Delete, from the foot of the details: asks first, and offers making the
		 * resource inactive instead - which keeps their bookings and leave - for as
		 * long as they are active.
		 */
		onDeleteResource: function () {
			var oDetail = this.getModel("mrDetail").getData();
			if (!oDetail.EmpID) {
				return;
			}
			var bActive = !!oDetail.Active;

			var oDialog = new Dialog({
				title: this.getText("mrDeleteTitle", [oDetail.FullName]),
				content: [
					new Text({ text: this.getText(bActive ? "mrDeleteText" : "mrDeleteTextInactive", [oDetail.FullName]) })
						.addStyleClass("hrxModalText")
				],
				buttons: [
					new Button({
						text: this.getText("mrDeleteConfirm"),
						press: function () {
							oDialog.close();
							this._deleteResource(oDetail);
						}.bind(this)
					}).addStyleClass("hrxModalBtn hrxModalBtnDanger"),
					new Button({
						text: this.getText("mrMakeInactive"),
						visible: bActive,
						press: function () {
							oDialog.close();
							this._setActive(false);
						}.bind(this)
					}).addStyleClass("hrxModalBtn hrxModalBtnGhost"),
					new Button({
						text: this.getText("mrCancel"),
						press: function () {
							oDialog.close();
						}
					}).addStyleClass("hrxModalBtn hrxModalBtnGhost")
				],
				afterClose: function () {
					oDialog.destroy();
				}
			}).addStyleClass("hrxModal");

			this.getView().addDependent(oDialog);
			oDialog.open();
		},

		/**
		 * Deletes the resource and everything that is theirs (HrxLegacy, Users.remove).
		 * @param {object} oDetail the resource on screen
		 */
		_deleteResource: function (oDetail) {
			this.getModel("mrView").setProperty("/saving", true);

			this._postJson(USERS_SERVICE + "?cmd=remove", { EmpID: oDetail.UserID }).then(function () {
				this.getModel("mrView").setProperty("/saving", false);
				MessageToast.show(this.getText("mrDeleted", [oDetail.FullName]));
				this._closeDetail();
				return this._loadResources();
			}.bind(this)).catch(function (oError) {
				this.getModel("mrView").setProperty("/saving", false);
				this._showError("mrErrorDelete", oError);
				// Part of it may be gone already; show what remains.
				return this._loadResources();
			}.bind(this));
		},

		/* =========================================================== */
		/* filter dialog                                               */
		/* =========================================================== */

		onOpenFilter: function () {
			var oViewModel = this.getModel("mrView");
			oViewModel.setProperty("/filterDraft", Object.assign({}, oViewModel.getProperty("/filter")));

			this._openDialog("_pFilterDialog", "bsx.hrx.hrx2026.fragment.ResourceFilterDialog");
		},

		onConfirmFilter: function () {
			var oViewModel = this.getModel("mrView");
			oViewModel.setProperty("/filter", Object.assign({}, oViewModel.getProperty("/filterDraft")));
			this._applyListFilters();
			this._closeDialog("_pFilterDialog");
		},

		onCancelFilter: function () {
			this._closeDialog("_pFilterDialog");
		},

		/* =========================================================== */
		/* add resource dialog                                         */
		/* =========================================================== */

		onOpenAddResource: function () {
			this.getModel("mrNew").setData(this._emptyNewResource());
			this._openDialog("_pAddDialog", "bsx.hrx.hrx2026.fragment.AddResourceDialog").then(function () {
				["newFirstName", "newEmail", "newSite", "newUserType"].forEach(function (sId) {
					var oControl = this.byId(sId);
					if (oControl) {
						oControl.setValueState("None");
					}
				}, this);
			}.bind(this));
		},

		onCancelAddResource: function () {
			this._closeDialog("_pAddDialog");
		},

		/**
		 * Validates a single field of the "new resource" dialog while typing.
		 * @param {sap.ui.base.Event} oEvent the liveChange/change event
		 */
		onNewResourceFieldChange: function (oEvent) {
			var oControl = oEvent.getSource();
			var sValue = oControl.getValue ? oControl.getValue() : "";

			if (oControl === this.byId("newEmail")) {
				this._validateEmailControl(oControl);
				return;
			}
			if (oControl !== this.byId("newFirstName")) {
				oControl.setValueState("None");
				return;
			}

			oControl.setValueState(sValue ? "None" : "Error");
			oControl.setValueStateText(this.getText("mrMandatory"));
		},

		onNewResourceSelectionChange: function (oEvent) {
			var oControl = oEvent.getSource();
			var bValid = !!oControl.getSelectedKey();
			oControl.setValueState(bValid ? "None" : "Error");
			oControl.setValueStateText(this.getText("mrMandatory"));
		},

		/**
		 * Creates the new resource through manageUsers.xsjs.
		 */
		onCreateResource: function () {
			if (!this._validateNewResource()) {
				this._reportNewResourceErrors();
				return;
			}

			var oNew = this.getModel("mrNew").getData();
			var oPayload = {
				UserID: "",
				EmpID: "",
				OrgID: this._sOrgId,
				BaseSiteKey: oNew.BaseSiteKey,
				FName: oNew.FName.trim(),
				LName: (oNew.LName || "").trim(),
				ManagerID: "",
				Mobile: oNew.Mobile || "",
				Email: oNew.Email.trim(),
				Pic: "",
				PicB: "",
				IsActive: "Y",
				Organization: "",
				IsPreReg: "N",
				UserTypeKey: oNew.UserTypeKey,
				HostID: "",
				VehRegNo: "",
				AccessCard: "",
				VisitingOn: "",
				VisitingAt: "",
				IsDeleted: "N",
				TargetUtilization: "",
				TargetHrsPerWeek: ""
			};
			var sJobTitle = (oNew.JobTitle || "").trim();

			this.getModel("mrView").setProperty("/saving", true);

			this._postJson(USERS_SERVICE + "?cmd=new", oPayload).then(function (oResult) {
				var sEmpId = oResult && oResult.EmpID;
				// The create call has no job title, so one given is saved straight after.
				var pJobTitle = sEmpId && sJobTitle ? this._saveJobTitle(sEmpId, sJobTitle) : Promise.resolve();

				return pJobTitle.then(function () {
					this.getModel("mrView").setProperty("/saving", false);
					MessageToast.show(oResult.msg || this.getText("mrCreated"));
					this._closeDialog("_pAddDialog");
					return this._loadResources();
				}.bind(this)).then(function () {
					// The new resource opens, as in the design
					if (sEmpId) {
						this._showResource(sEmpId);
					}
				}.bind(this));
			}.bind(this)).catch(function (oError) {
				this.getModel("mrView").setProperty("/saving", false);
				this._showError("mrErrorCreate", oError);
			}.bind(this));
		},

		/**
		 * Gives a resource that was just created its job title: the resource is read back
		 * and saved again through the same update call as the detail's Save.
		 * @param {string} sEmpId the new resource's EmpID
		 * @param {string} sJobTitle the job title entered in the add dialog
		 * @returns {Promise} resolved once saved
		 */
		_saveJobTitle: function (sEmpId, sJobTitle) {
			return this._read(Backend.keyPath("Resources", { EmpID: sEmpId })).then(function (oResource) {
				var oDetail = this._toDetail(oResource);
				oDetail.JobTitle = sJobTitle;
				return this._postJson(USERS_SERVICE + "?cmd=update&visitorx=", this._toUpdatePayload(oDetail));
			}.bind(this));
		},

		/**
		 * @returns {boolean} true when every mandatory field of the add dialog is filled
		 */
		_validateNewResource: function () {
			var bValid = true;

			[
				{ id: "newFirstName", path: "/FName" }
			].forEach(function (oField) {
				var oControl = this.byId(oField.id);
				var bFilled = !!(this.getModel("mrNew").getProperty(oField.path) || "").trim();
				oControl.setValueState(bFilled ? "None" : "Error");
				oControl.setValueStateText(this.getText("mrMandatory"));
				bValid = bValid && bFilled;
			}, this);

			bValid = this._validateEmailControl(this.byId("newEmail")) && bValid;

			["newSite", "newUserType"].forEach(function (sId) {
				var oControl = this.byId(sId);
				var bFilled = !!oControl.getSelectedKey();
				oControl.setValueState(bFilled ? "None" : "Error");
				oControl.setValueStateText(this.getText("mrMandatory"));
				bValid = bValid && bFilled;
			}, this);

			return bValid;
		},

		/**
		 * Says why the new resource was not saved: the mandatory fields still empty,
		 * and an email address that is not one. The fields themselves are already
		 * marked (_validateNewResource).
		 */
		_reportNewResourceErrors: function () {
			var aMissing = [];
			var bBadEmail = false;
			[
				{ id: "newFirstName", label: "mrFieldFirstName" },
				{ id: "newEmail", label: "mrFieldEmail" },
				{ id: "newSite", label: "mrFieldLocation" },
				{ id: "newUserType", label: "mrFieldUserType" }
			].forEach(function (oField) {
				var oControl = this.byId(oField.id);
				if (oControl.getValueState() !== "Error") {
					return;
				}
				// Location and resource type are pick lists; the rest are typed in
				var bPick = oControl.isA("sap.m.Select") || oControl.isA("sap.m.ComboBoxBase");
				var bEmpty = bPick ? !oControl.getSelectedKey() : !(oControl.getValue() || "").trim();
				if (bEmpty) {
					aMissing.push(this.getText(oField.label));
				} else if (oField.id === "newEmail") {
					bBadEmail = true;
				}
			}, this);

			var aLines = [];
			if (aMissing.length) {
				aLines.push(this.getText("mrNotSavedMissing", [aMissing.join(", ")]));
			}
			if (bBadEmail) {
				aLines.push(this.getText("mrNotSavedEmail"));
			}
			MessageBox.error(aLines.join("\n\n"), { title: this.getText("mrNotSavedTitle") });
		},

		_validateEmailControl: function (oControl) {
			var sValue = (oControl.getValue() || "").trim();

			if (!sValue) {
				oControl.setValueState("Error");
				oControl.setValueStateText(this.getText("mrMandatory"));
				return false;
			}
			if (!EMAIL_PATTERN.test(sValue)) {
				oControl.setValueState("Error");
				oControl.setValueStateText(this.getText("mrInvalidEmail"));
				return false;
			}

			oControl.setValueState("None");
			return true;
		},

		/* =========================================================== */
		/* helpers                                                     */
		/* =========================================================== */

		getModel: function (sName) {
			return this.getView().getModel(sName);
		},

		setModel: function (oModel, sName) {
			this.getView().setModel(oModel, sName);
			return this;
		},

		getResourceBundle: function () {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle();
		},

		getText: function (sKey, aArgs) {
			return this.getResourceBundle().getText(sKey, aArgs);
		},

		/**
		 * Reads from the OData service and wraps the callback API in a promise.
		 * @param {string} sPath the entity set or entity path
		 * @param {object} [mParameters] additional read parameters (filters, urlParameters, ...)
		 * @returns {Promise<object>} the response data
		 */
		_read: function (sPath, mParameters) {
			// Backend.read, not a bare model.read: it waits for the service metadata,
			// including the retries Component.js makes after a failed first attempt, so
			// a momentary outage at startup no longer leaves every value help on the
			// page empty for the rest of the session.
			return Backend.read(this.getOwnerComponent().getModel(), sPath, mParameters);
		},

		_getJson: function (sUrl) {
			return this._request(sUrl, { method: "GET" });
		},

		_postJson: function (sUrl, oPayload) {
			return this._request(sUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(oPayload)
			});
		},

		/**
		 * Calls one of the XS JavaScript services and normalises its error handling:
		 * these services answer with HTTP 200 and a msgType of "S" on success.
		 * @param {string} sUrl the service url
		 * @param {object} oInit fetch options
		 * @returns {Promise<object>} the parsed response
		 */
		_request: function (sUrl, oInit) {
			// Through Backend, which answers from the HRX service where it can.
			return Backend.request(sUrl, oInit);
		},

		_openDialog: function (sCacheKey, sFragmentName) {
			if (!this[sCacheKey]) {
				this[sCacheKey] = Fragment.load({
					id: this.getView().getId(),
					name: sFragmentName,
					controller: this
				}).then(function (oDialog) {
					this.getView().addDependent(oDialog);
					return oDialog;
				}.bind(this));
			}

			return this[sCacheKey].then(function (oDialog) {
				oDialog.open();
				return oDialog;
			});
		},

		_closeDialog: function (sCacheKey) {
			if (this[sCacheKey]) {
				this[sCacheKey].then(function (oDialog) {
					oDialog.close();
				});
			}
		},

		_resolveOrgId: function () {
			return CurrentUser.orgId(this.getOwnerComponent());
		},

		/**
		 * Every resource to start with, as the design lists them: any type, active or
		 * not, every location. The filter dialog narrows it.
		 * @returns {object} the default list filter
		 */
		_defaultFilter: function () {
			return { userType: "A", active: "A", site: ALL_SITES };
		},

		_emptyNewResource: function () {
			return {
				FName: "",
				LName: "",
				Email: "",
				Mobile: "",
				BaseSiteKey: "",
				UserTypeKey: "S",
				JobTitle: ""
			};
		},

		_emptyLeaveData: function () {
			return {
				loaded: false,
				user: {},
				availedLeaves: [],
				requests: [],
				bankHolidays: [],
				analyticsData: []
			};
		},

		_toNumber: function (vValue) {
			var fValue = parseFloat(vValue);
			return isNaN(fValue) ? 0 : fValue;
		},

		_errorText: function (oError) {
			if (!oError) {
				return "";
			}
			if (oError.message) {
				return oError.message;
			}
			if (oError.responseText) {
				try {
					var oBody = JSON.parse(oError.responseText);
					return oBody.msg || oBody.error && oBody.error.message && oBody.error.message.value || oError.responseText;
				} catch (oParseError) {
					return oError.responseText;
				}
			}
			return String(oError);
		},

		_showError: function (sTextKey, oError) {
			MessageBox.error(this.getText(sTextKey), {
				details: this._errorText(oError)
			});
		}
	}));
});
