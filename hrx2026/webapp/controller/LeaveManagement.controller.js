sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Fragment",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageToast",
	"sap/m/MessageBox",
	"sap/m/Dialog",
	"sap/m/Button",
	"sap/m/Label",
	"sap/m/Text",
	"sap/m/TextArea",
	"sap/m/VBox",
	"../model/Backend",
	"../model/CurrentUser",
	"../model/Hrx",
	"../model/HrxTime",
	"../model/HrxLegacy",
	"../model/SicknessPolicy",
	"../model/formatter",
	"./BookLeave"
], function (Controller, Fragment, JSONModel, MessageToast, MessageBox, Dialog, Button, Label, Text, TextArea, VBox,
	Backend, CurrentUser, Hrx, HrxTime, HrxLegacy, SicknessPolicy, formatter, BookLeave) {
	"use strict";

	var DAY_FLAGS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

	var STATUS = {
		REQ: { key: "lmPending", state: "Warning" },
		APR: { key: "lmApproved", state: "Success" },
		REJ: { key: "lmRejected", state: "Error" }
	};

	/*
	 * Leave management (admin): every request waiting for a decision, and the team's
	 * leave over a financial year. Managers and admins see everyone's; Book leave
	 * offers a manager their direct reports, and full access everyone.
	 *
	 * Read straight from the HRX service. A request is the Leaves rows sharing a
	 * LeaveGrpID - one row per day when booked through the app.
	 */
	return Controller.extend("bsx.hrx.hrx2026.controller.LeaveManagement", Object.assign({}, BookLeave, {

		formatter: formatter,

		onInit: function () {
			var oToday = new Date();
			var oYear = SicknessPolicy.fiscalYearOf(oToday);

			this._iLoad = 0;
			this.setModel(new JSONModel({
				busy: false,
				pendingBusy: false,
				q: "",
				year: oYear,
				isLastYear: false
			}), "lmView");
			this.setModel(new JSONModel({ rows: [], pending: [], countText: "", pendingText: "" }), "lm");

			this.getOwnerComponent().getRouter().getRoute("leavemanagement")
				.attachPatternMatched(this._onRouteMatched, this);
		},

		_onRouteMatched: function () {
			CurrentUser.ready(this.getOwnerComponent()).then(function (oProfile) {
				this._oProfile = oProfile;
				this._sOrgId = oProfile.orgId;
				if (oProfile.isManager) {
					this._load();
				}
			}.bind(this));
		},

		onRefresh: function () {
			return this._load();
		},

		/**
		 * Reads the people, the leave types and work patterns (once), then the year's
		 * leave and every pending request.
		 * @returns {Promise} resolved once both cards are filled
		 */
		_load: function () {
			var oViewModel = this.getModel("lmView");
			var oYear = oViewModel.getProperty("/year");
			var iLoad = ++this._iLoad;

			oViewModel.setProperty("/busy", true);
			oViewModel.setProperty("/pendingBusy", true);

			if (!this._pRefs) {
				this._pRefs = Promise.all([
					HrxTime.people(),
					HrxLegacy.leaveTypes(),
					Hrx.list("WorkSchedule")
				]).then(function (aResults) {
					var oRefs = { people: {}, types: {}, patterns: {}, list: aResults[0] };
					aResults[0].forEach(function (oPerson) {
						oRefs.people[oPerson.EmpID] = oPerson;
					});
					aResults[1].forEach(function (oType) {
						oRefs.types[oType.ID] = oType;
					});
					aResults[2].forEach(function (oSchedule) {
						oRefs.patterns[oSchedule.EmployeeID_EmployeeID] = DAY_FLAGS.map(function (sFlag) {
							return oSchedule[sFlag] === true;
						});
					});
					return oRefs;
				});
				this._pRefs.catch(function () {
					this._pRefs = null;
				}.bind(this));
			}

			return this._pRefs.then(function (oRefs) {
				this._oRefs = oRefs;
				return Promise.all([
					Hrx.list("Leaves", { $filter: "StartDate le " + oYear.to + " and EndDate ge " + oYear.from }),
					Hrx.list("Leaves", { $filter: "ApprovalRequired eq true and WFFlag eq null" })
				]);
			}.bind(this)).then(function (aResults) {
				if (iLoad !== this._iLoad) {
					return;
				}
				this._aRows = this._requests(aResults[0]);
				this.getModel("lm").setProperty("/pending", this._requests(aResults[1].filter(function (oLeave) {
					return HrxLegacy.leaveStatus(oLeave) === "REQ";
				})).sort(function (a, b) {
					return a.from.localeCompare(b.from);
				}));
				this._render();
			}.bind(this)).catch(function (oError) {
				if (iLoad === this._iLoad) {
					this._aRows = [];
					this.getModel("lm").setProperty("/pending", []);
					this._render();
					this._showError("lmErrorLoad", oError);
				}
			}.bind(this)).then(function () {
				if (iLoad === this._iLoad) {
					oViewModel.setProperty("/busy", false);
					oViewModel.setProperty("/pendingBusy", false);
				}
			}.bind(this));
		},

		/**
		 * Gathers Leaves rows into requests: one per LeaveGrpID and status, since a
		 * request decided day by day can carry more than one.
		 * @param {Array<object>} aLeaves Leaves rows
		 * @returns {Array<object>} requests, ready for the cards
		 */
		_requests: function (aLeaves) {
			var oRefs = this._oRefs;
			var mGroups = {};

			aLeaves.forEach(function (oLeave) {
				var sStatus = HrxLegacy.leaveStatus(oLeave);
				var sKey = (oLeave.LeaveGrpID || oLeave.ID) + "|" + sStatus;
				var oGroup = mGroups[sKey] = mGroups[sKey] || { status: sStatus, rows: [] };
				oGroup.rows.push(oLeave);
			});

			return Object.keys(mGroups).map(function (sKey) {
				var oGroup = mGroups[sKey];
				var aRows = oGroup.rows;
				var oFirst = aRows[0];
				var oPerson = oRefs.people[oFirst.EmpID_EmployeeID] || { Name: oFirst.EmpID_EmployeeID, Email: "" };
				var oType = oRefs.types[oFirst.LeaveCategoryId_ID] || { code: "", desc: "" };
				var aPattern = oRefs.patterns[oFirst.EmpID_EmployeeID];
				var sFrom = aRows.reduce(function (s, o) {
					return o.StartDate < s ? o.StartDate : s;
				}, oFirst.StartDate);
				var sTo = aRows.reduce(function (s, o) {
					return o.EndDate > s ? o.EndDate : s;
				}, oFirst.EndDate);
				var aSlots = aRows.map(function (o) {
					var sSlot = String(o.DayTime || "").trim().toUpperCase();
					return sSlot === "AM" || sSlot === "PM" ? sSlot : "FULL";
				});
				var fDays = aRows.reduce(function (fTotal, o, i) {
					return fTotal + (aSlots[i] !== "FULL" ? 0.5 :
						SicknessPolicy.workingDays(SicknessPolicy.parseDay(o.StartDate), SicknessPolicy.parseDay(o.EndDate), aPattern));
				}, 0);
				var sDuration = aSlots.every(function (s) {
					return s === "FULL";
				}) ? "lmFullDay" : aSlots.every(function (s) {
					return s === "AM";
				}) ? "lmMorning" : aSlots.every(function (s) {
					return s === "PM";
				}) ? "lmAfternoon" : "lmMixed";
				var oStatus = STATUS[oGroup.status] || STATUS.REQ;

				return {
					ids: aRows.map(function (o) {
						return o.ID;
					}),
					EmpID: oFirst.EmpID_EmployeeID,
					Name: oPerson.Name,
					Email: oPerson.Email,
					initials: formatter.nameInitials(oPerson.Name),
					from: sFrom,
					to: sTo,
					dates: sFrom === sTo ? formatter.date(sFrom) : formatter.dateRange(sFrom, sTo),
					days: fDays,
					daysNum: fDays.toFixed(1),
					daysText: this.getText(fDays === 1 ? "lmOneDay" : "lmDays", [fDays]),
					type: oType.desc,
					duration: this.getText(sDuration),
					typeText: oType.desc + " · " + this.getText(sDuration),
					dotHtml: "<span class=\"hrxLmDot hrxLmDot" + (oType.code || "OTHER") + "\"></span>",
					status: oGroup.status,
					statusText: this.getText(oStatus.key),
					statusState: oStatus.state
				};
			}, this);
		},

		/**
		 * Fills the team leave table from the year's requests and the search.
		 */
		_render: function () {
			var oModel = this.getModel("lm");
			var sQuery = (this.getModel("lmView").getProperty("/q") || "").trim().toLowerCase();
			var aAll = this._aRows || [];
			var aRows = aAll.filter(function (oRow) {
				return !sQuery || oRow.Name.toLowerCase().indexOf(sQuery) !== -1;
			}).sort(function (a, b) {
				return b.from.localeCompare(a.from) || a.Name.localeCompare(b.Name);
			});
			var iPending = (oModel.getProperty("/pending") || []).length;

			oModel.setProperty("/rows", aRows);
			oModel.setProperty("/countText", this.getText("lmCount", [aAll.length,
				this.getModel("lmView").getProperty("/year/label")]));
			oModel.setProperty("/pendingText", this.getText("approvalsPending", [iPending]));
		},

		onSearch: function () {
			this._render();
		},

		/**
		 * Steps a financial year back or forward. Leave is booked ahead, so next year
		 * can be looked at too, but no further.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onStepYear: function (oEvent) {
			var iStep = oEvent.getSource().data("step") === "next" ? 1 : -1;
			var oViewModel = this.getModel("lmView");
			var iLast = SicknessPolicy.fiscalYearOf(new Date()).startYear + 1;
			var iYear = Math.min(oViewModel.getProperty("/year/startYear") + iStep, iLast);

			oViewModel.setProperty("/year", SicknessPolicy.fiscalYear(iYear));
			oViewModel.setProperty("/isLastYear", iYear === iLast);
			this._load();
		},

		/* =========================================================== */
		/* approvals                                                   */
		/* =========================================================== */

		onApprove: function (oEvent) {
			this._decide(oEvent.getSource().getBindingContext("lm").getObject(), "APR", "");
		},

		/**
		 * Asks for an optional note to the employee before turning the request down.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onReject: function (oEvent) {
			var oRequest = oEvent.getSource().getBindingContext("lm").getObject();
			var oNote = new TextArea({
				width: "100%",
				rows: 3,
				maxLength: 500,
				placeholder: this.getText("mgrDeclineNotePlaceholder")
			});
			var oDialog = new Dialog({
				title: this.getText("mgrDeclineTitle"),
				contentWidth: "28rem",
				content: new VBox({
					items: [
						new Text({ text: oRequest.Name + " · " + oRequest.dates + " · " + oRequest.typeText })
							.addStyleClass("hrxResourceMeta sapUiSmallMarginBottom"),
						new Label({ text: this.getText("mgrDeclineNote"), labelFor: oNote }),
						oNote
					]
				}).addStyleClass("sapUiSmallMargin"),
				beginButton: new Button({
					text: this.getText("btnReject"),
					type: "Reject",
					press: function () {
						var sNote = oNote.getValue().trim();
						oDialog.close();
						this._decide(oRequest, "REJ", sNote);
					}.bind(this)
				}),
				endButton: new Button({
					text: this.getText("dmCancel"),
					press: function () {
						oDialog.close();
					}
				}),
				afterClose: function () {
					oDialog.destroy();
				}
			});
			this.getView().addDependent(oDialog);
			oDialog.open();
		},

		/**
		 * Decides every day of a request in one call.
		 * @param {object} oRequest the request
		 * @param {string} sStatus "APR" or "REJ"
		 * @param {string} sNote the approver's note to the employee
		 */
		_decide: function (oRequest, sStatus, sNote) {
			var oProfile = this._oProfile || {};
			var sToday = this._isoDate(new Date());

			this.getModel("lmView").setProperty("/pendingBusy", true);
			Backend.postJson(Backend.LEAVE_APPROVALS + "?cmd=action", {
				LeaveReqSet: oRequest.ids.map(function (sId) {
					return {
						LeaveID: sId,
						RequesterID: oRequest.EmpID,
						RequesterName: oRequest.Name,
						RequesterEmail: oRequest.Email,
						Status: sStatus,
						OrgID: this._sOrgId,
						ApprovedOn: sToday,
						ApprovedBy: oProfile.empID || "",
						ApproverName: oProfile.name || "",
						ApproverEmail: oProfile.email || "",
						ApproverComments: sNote || ""
					};
				}, this)
			}).then(function () {
				MessageToast.show(this.getText(sStatus === "APR" ? "mgrApprovedToast" : "mgrDeclinedToast", [oRequest.Name]));
				return this._load();
			}.bind(this)).catch(function (oError) {
				this.getModel("lmView").setProperty("/pendingBusy", false);
				this._showError("tcErrorApprovalAction", oError);
			}.bind(this));
		},

		/* =========================================================== */
		/* book leave                                                  */
		/* =========================================================== */

		/**
		 * Book leave for someone: a manager's direct reports, or anyone with full access.
		 */
		onOpenBook: function () {
			var oProfile = this._oProfile || {};
			var bEveryone = CurrentUser.hasFullAccess();

			(this._pRefs || Promise.reject(new Error("not loaded"))).then(function (oRefs) {
				var aEmployees = oRefs.list.filter(function (oPerson) {
					return oPerson.IsActive && (bEveryone || oPerson.ManagerID === oProfile.empID);
				}).map(function (oPerson) {
					return { EmpID: oPerson.EmpID, EmpName: oPerson.Name, EmpEmail: oPerson.Email, SiteID: oPerson.SiteID };
				});

				if (!aEmployees.length) {
					MessageBox.information(this.getText("lmNoReports"));
					return;
				}
				this.openBookLeave(null, aEmployees);
			}.bind(this)).catch(function (oError) {
				this._showError("lmErrorLoad", oError);
			}.bind(this));
		},

		_afterBookLeave: function () {
			return this._load();
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

		getText: function (sKey, aArgs) {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(sKey, aArgs);
		},

		_isoDate: function (oDate) {
			return Backend.isoDate(oDate);
		},

		_read: function (sPath, mParameters) {
			return Backend.read(this.getOwnerComponent().getModel(), sPath, mParameters);
		},

		_getJson: function (sUrl) {
			return Backend.request(sUrl, { method: "GET" });
		},

		_postJson: function (sUrl, oPayload) {
			return Backend.request(sUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(oPayload)
			});
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

		_showError: function (sTextKey, oError) {
			MessageBox.error(this.getText(sTextKey), {
				details: (oError && oError.message) || String(oError)
			});
		}
	}));
});
