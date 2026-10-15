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
	"../model/TeamLeave",
	"../model/Mail",
	"../model/formatter",
	"./BookLeave"
], function (Controller, Fragment, JSONModel, MessageToast, MessageBox, Dialog, Button, Label, Text, TextArea, VBox,
	Backend, CurrentUser, TeamLeave, Mail, formatter, BookLeave) {
	"use strict";

	var TEAM_SERVICE = Backend.SERVICE_ROOT + "/hrx/teamCalendar1.xsjs";

	// The leave types in the calendar's colour key, in the design's order.
	var LEGEND_TYPES = ["COMPL", "HOLIL", "MATEL", "PATEL", "SICKL", "UNPDL"];

	/*
	 * Team Calendar, as the 15.10.26 design has it.
	 *
	 * Team leave (managers only, what was the Leave Management page): the requests in
	 * a period - the next month by default, any month of the financial year, the
	 * whole year or a range - by status, to approve or reject. Clicking one moves the
	 * calendar to its week and opens it there.
	 *
	 * Availability: who is away, week or month, filtered by team (a manager starts on
	 * their direct reports), people, site and project. Approved leave is drawn in its
	 * leave type's colour; a request still waiting is hatched and only shown to a
	 * manager, who can open it - or "N pending" under a name - to decide it.
	 *
	 * Everybody's leave comes from teamCalendar1.xsjs (answered by the HRX service, see
	 * HrxLegacy); the requests behind it come from model/TeamLeave.
	 */
	return Controller.extend("bsx.hrx.hrx2026.controller.TeamCalendar", Object.assign({}, BookLeave, {

		formatter: formatter,

		/* =========================================================== */
		/* lifecycle                                                   */
		/* =========================================================== */

		onInit: function () {
			this._sOrgId = CurrentUser.orgId(this.getOwnerComponent());
			this._aCalendarPeople = [];
			this._aPending = [];
			this._aPeriodRequests = [];
			this._aCalendarRequests = [];
			this._aProjects = [];

			this.setModel(new JSONModel({
				startDate: this._mondayOf(new Date()),
				busy: true,
				viewKey: "week",
				isManager: false,
				myEmpId: "",
				team: "mine",
				site: "all",
				project: "all",
				selectedResources: [],
				title: this.getText("tcTitle"),
				periodLabel: ""
			}), "tcView");

			this.setModel(new JSONModel({
				people: [],
				pool: [],
				sites: [],
				projects: [],
				legend: []
			}), "tc");

			this.setModel(new JSONModel({
				busy: false,
				period: "next",
				rangeFrom: null,
				rangeTo: null,
				q: "",
				status: "REQ"
			}), "tlView");

			this.setModel(new JSONModel({
				periods: TeamLeave.periods(new Date(), this.getText.bind(this)),
				chips: [],
				rows: [],
				countText: "",
				noDataText: ""
			}), "tl");

			this.setModel(new JSONModel({ kind: "", pending: [] }), "tcPop");

			this.getOwnerComponent().getRouter().getRoute("teamcal")
				.attachPatternMatched(this._onRouteMatched, this);
		},

		/**
		 * Every visit opens on this week and on the manager's own team.
		 */
		_onRouteMatched: function () {
			var oViewModel = this.getModel("tcView");
			oViewModel.setProperty("/selectedResources", []);
			oViewModel.setProperty("/site", "all");
			oViewModel.setProperty("/project", "all");

			return CurrentUser.ready(this.getOwnerComponent()).then(function (oProfile) {
				this._oProfile = oProfile;
				this._sOrgId = oProfile.orgId;

				if (!oProfile.email) {
					oViewModel.setProperty("/busy", false);
					if (CurrentUser.shouldReportMissingIdentity()) {
						this._showError("tcErrorNoIdentity", null);
					}
					return undefined;
				}

				oViewModel.setProperty("/isManager", !!oProfile.isManager);
				oViewModel.setProperty("/myEmpId", oProfile.empID || "");
				this._applyView(this._currentViewKey(), new Date());
				return this._loadAll();
			}.bind(this));
		},

		onRefresh: function () {
			return this._loadAll();
		},

		/* =========================================================== */
		/* loading                                                     */
		/* =========================================================== */

		/**
		 * The lookups (sites, projects, the legend), then the calendar and the requests.
		 * @returns {Promise} resolved once everything on the page is filled
		 */
		_loadAll: function () {
			return Promise.all([
				TeamLeave.references(),
				TeamLeave.assignedProjects().catch(function () {
					// The project filter is not in the MVP; the page works without it.
					return [];
				})
			]).then(function (aResults) {
				this._oReferences = aResults[0];
				this._aProjects = aResults[1];
				this._fillLookups();
				return Promise.all([this._loadCalendar(), this._loadRequests()]);
			}.bind(this)).catch(function (oError) {
				this.getModel("tcView").setProperty("/busy", false);
				this._showError("lmErrorLoad", oError);
			}.bind(this));
		},

		_fillLookups: function () {
			var oModel = this.getModel("tc");
			var mSites = this._oReferences.sites;
			var mTypeNames = {};

			Object.keys(this._oReferences.types).forEach(function (sId) {
				var oType = this._oReferences.types[sId];
				mTypeNames[oType.code] = oType.desc;
			}, this);

			oModel.setProperty("/sites", [{ key: "all", text: this.getText("tcSiteAll") }].concat(
				Object.keys(mSites).map(function (sId) {
					return { key: sId, text: mSites[sId] };
				}).sort(function (a, b) {
					return a.text.localeCompare(b.text);
				})));

			oModel.setProperty("/projects", [{ key: "all", text: this.getText("tcProjectAll") }].concat(
				this._aProjects.map(function (oProject) {
					return { key: oProject.ID, text: oProject.name };
				})));

			oModel.setProperty("/legend", LEGEND_TYPES.filter(function (sCode) {
				return !!mTypeNames[sCode];
			}).map(function (sCode) {
				return { text: mTypeNames[sCode], colour: TeamLeave.colourOf(sCode) };
			}));
		},

		/**
		 * Everybody's leave for the period the calendar shows, and the requests behind it.
		 * @returns {Promise} resolved once the calendar is filled
		 */
		_loadCalendar: function () {
			var oViewModel = this.getModel("tcView");
			var oPeriod = this._calendarPeriod();

			oViewModel.setProperty("/busy", true);
			oViewModel.setProperty("/periodLabel", formatter.dateRange(oPeriod.from, oPeriod.to));

			return Promise.all([
				this._getJson(TEAM_SERVICE + "?cmd=team&" + new URLSearchParams({
					OrgID: this._sOrgId,
					Email: this._oProfile.email,
					FromDate: this._isoDate(oPeriod.from),
					ToDate: this._isoDate(oPeriod.to)
				}).toString()),
				TeamLeave.leavesBetween(this._isoDate(oPeriod.from), this._isoDate(oPeriod.to))
			]).then(function (aResults) {
				var oUser = (aResults[0].loggedinUser || [])[0] || {};
				// The team service knows whether this person has anybody reporting to them.
				oViewModel.setProperty("/isManager", oUser.IsManager === "Y" || !!this._oProfile.isManager);
				oViewModel.setProperty("/myEmpId", oUser.EmpID || this._oProfile.empID || "");

				this._aCalendarPeople = aResults[0].users || [];
				this._aCalendarRequests = TeamLeave.toRequests(aResults[1], this._oReferences, this.getText.bind(this));
				this._chooseStartingTeam();
				this._renderCalendar();
				// Team leave lists the people the calendar shows, so it follows them.
				this._renderLeave();
				oViewModel.setProperty("/busy", false);
			}.bind(this)).catch(function (oError) {
				oViewModel.setProperty("/busy", false);
				this._aCalendarPeople = [];
				this._renderCalendar();
				this._showError("tcErrorTeam", oError);
			}.bind(this));
		},

		/**
		 * The requests for the Team leave card: those in its period, and everything
		 * still pending (for the counts under each name and "approve all").
		 * @returns {Promise} resolved once the card is filled
		 */
		_loadRequests: function () {
			var oLeaveViewModel = this.getModel("tlView");
			var oPeriod = this._leavePeriod();
			var fnText = this.getText.bind(this);

			oLeaveViewModel.setProperty("/busy", true);

			return Promise.all([
				oPeriod ? TeamLeave.leavesBetween(this._isoDate(oPeriod.from), this._isoDate(oPeriod.to)) : Promise.resolve([]),
				TeamLeave.pendingLeaves()
			]).then(function (aResults) {
				this._aPeriodRequests = TeamLeave.toRequests(aResults[0], this._oReferences, fnText);
				this._aPending = TeamLeave.toRequests(aResults[1], this._oReferences, fnText);
				oLeaveViewModel.setProperty("/busy", false);
				this._renderCalendar();
				this._renderLeave();
			}.bind(this)).catch(function (oError) {
				oLeaveViewModel.setProperty("/busy", false);
				this._showError("lmErrorLoad", oError);
			}.bind(this));
		},

		/**
		 * A manager opens on their own team - unless nobody reports to them (an admin
		 * who runs resourcing, say), when that would be an empty page.
		 */
		_chooseStartingTeam: function () {
			if (this._bTeamChosen) {
				return;
			}
			this._bTeamChosen = true;
			var sMe = this.getModel("tcView").getProperty("/myEmpId");
			var bHasReports = this._aCalendarPeople.some(function (oPerson) {
				return oPerson.ManagerID === sMe;
			});
			this.getModel("tcView").setProperty("/team", bHasReports ? "mine" : "all");
		},

		/* =========================================================== */
		/* who is shown                                                */
		/* =========================================================== */

		/**
		 * @returns {Array<object>} the people the Team choice covers: a manager's direct
		 * reports (or everyone), and everyone for an employee
		 */
		_pool: function () {
			var oViewModel = this.getModel("tcView");
			var sMe = oViewModel.getProperty("/myEmpId");
			var bMineOnly = oViewModel.getProperty("/isManager") && oViewModel.getProperty("/team") === "mine";

			return this._aCalendarPeople.filter(function (oPerson) {
				return !bMineOnly || oPerson.ManagerID === sMe;
			});
		},

		/**
		 * @returns {Array<object>} the pool narrowed by the people, site and project
		 * filters; for a manager, anyone with a request waiting comes first
		 */
		_shown: function () {
			var oViewModel = this.getModel("tcView");
			var aPicked = oViewModel.getProperty("/selectedResources") || [];
			var sSite = oViewModel.getProperty("/site");
			var sProject = oViewModel.getProperty("/project");
			var bManager = oViewModel.getProperty("/isManager");
			var oProject = this._aProjects.filter(function (oCandidate) {
				return oCandidate.ID === sProject;
			})[0];

			return this._pool().filter(function (oPerson) {
				return (sSite === "all" || oPerson.SiteID === sSite) &&
					(!aPicked.length || aPicked.indexOf(oPerson.EmpID) !== -1) &&
					(sProject === "all" || (oProject && oProject.empIds.indexOf(oPerson.EmpID) !== -1));
			}).sort(function (a, b) {
				var bAWaiting = bManager && this._pendingOf(a.EmpID).length > 0;
				var bBWaiting = bManager && this._pendingOf(b.EmpID).length > 0;
				if (bAWaiting !== bBWaiting) {
					return bAWaiting ? -1 : 1;
				}
				return a.Name.localeCompare(b.Name);
			}.bind(this));
		},

		/**
		 * @param {string} sEmpId an employee
		 * @returns {Array<object>} their requests still waiting, earliest first
		 */
		_pendingOf: function (sEmpId) {
			return this._aPending.filter(function (oRequest) {
				return oRequest.EmpID === sEmpId;
			}).sort(function (a, b) {
				return a.from.localeCompare(b.from);
			});
		},

		/* =========================================================== */
		/* rendering                                                   */
		/* =========================================================== */

		_renderCalendar: function () {
			var oViewModel = this.getModel("tcView");
			var bManager = oViewModel.getProperty("/isManager");
			var sSelectedKey = this._sSelectedRequestKey;
			var mRequestByLeaveId = this._requestsByLeaveId();
			var aPeople = this._shown().map(function (oPerson) {
				return this._toRow(oPerson, bManager, mRequestByLeaveId, sSelectedKey);
			}, this);

			this.getModel("tc").setProperty("/pool", this._pool().map(function (oPerson) {
				return { EmpID: oPerson.EmpID, Name: oPerson.Name };
			}).sort(function (a, b) {
				return a.Name.localeCompare(b.Name);
			}));
			this.getModel("tc").setProperty("/people", aPeople);
			oViewModel.setProperty("/title", this.getText("tcTitleCount", [aPeople.length]));
		},

		/**
		 * One person's calendar row: their leave as appointments, coloured by leave type.
		 * A request still waiting is hatched (tentative), and only a manager sees it.
		 * @param {object} oPerson a person from the team service
		 * @param {boolean} bManager whether the signed-in user is a manager
		 * @param {object} mRequestByLeaveId the requests behind the leave, by Leaves ID
		 * @param {string} [sSelectedKey] the request to show as selected
		 * @returns {object} the row
		 */
		_toRow: function (oPerson, bManager, mRequestByLeaveId, sSelectedKey) {
			var aLeave = (oPerson.Leave || []).filter(function (oDay) {
				return oDay.StatusID === "APR" || (bManager && oDay.StatusID === "REQ");
			}).map(function (oDay) {
				var oDate = formatter.toDate(oDay.Date);
				if (!oDate) {
					return null;
				}
				var sHalf = oDay.AbsenceType;
				var oRequest = mRequestByLeaveId[oDay.LeaveID];
				var bBankHoliday = oDay.LeaveTypeID === "BANKHOLIDAY";

				return {
					leaveId: oDay.LeaveID || "",
					requestKey: oRequest ? oRequest.key : "",
					start: new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate(), sHalf === "PM" ? 13 : 0, 0),
					end: new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate(), sHalf === "AM" ? 13 : 23, sHalf === "AM" ? 0 : 59),
					title: oDay.LeaveType + (sHalf ? " · " + sHalf : ""),
					info: bBankHoliday ? this.getText("tcBankHoliday") : "",
					colour: TeamLeave.colourOf(oDay.LeaveTypeID),
					tentative: oDay.StatusID === "REQ",
					selected: !!oRequest && oRequest.key === sSelectedKey,
					tooltip: oPerson.Name + " · " + oDay.LeaveType + (oRequest ? " · " + oRequest.dates + " · " + oRequest.statusText : "")
				};
			}, this).filter(Boolean);

			var iPending = this._pendingOf(oPerson.EmpID).length;
			var sSite = this._oReferences.sites[oPerson.SiteID] || "";

			return {
				EmpID: oPerson.EmpID,
				Name: oPerson.Name,
				Pic: oPerson.Pic || "",
				initials: formatter.nameInitials(oPerson.Name),
				subText: [oPerson.JobTitle, sSite].filter(Boolean).join(" · "),
				pendingCount: iPending,
				pendingText: this.getText("tcPendingCount", [iPending]),
				Leave: aLeave
			};
		},

		/**
		 * @returns {object} every request the page knows about, by the ID of each of its Leaves rows
		 */
		_requestsByLeaveId: function () {
			var mRequests = {};
			this._aCalendarRequests.concat(this._aPeriodRequests, this._aPending).forEach(function (oRequest) {
				oRequest.ids.forEach(function (sLeaveId) {
					mRequests[sLeaveId] = oRequest;
				});
			});
			return mRequests;
		},

		/**
		 * Fills the Team leave card: the period's requests for the people shown, by the
		 * chosen status.
		 */
		_renderLeave: function () {
			var oLeaveView = this.getModel("tlView").getData();
			var oModel = this.getModel("tl");
			var oPeriod = this._leavePeriod();
			var mShown = {};
			this._shown().forEach(function (oPerson) {
				mShown[oPerson.EmpID] = true;
			});
			var sQuery = (oLeaveView.q || "").trim().toLowerCase();

			var aInScope = this._aPeriodRequests.filter(function (oRequest) {
				return mShown[oRequest.EmpID] && (!sQuery || oRequest.Name.toLowerCase().indexOf(sQuery) !== -1);
			});
			var fnCount = function (sStatus) {
				return aInScope.filter(function (oRequest) {
					return oRequest.status === sStatus;
				}).length;
			};

			oModel.setProperty("/chips", ["REQ", "APR", "REJ"].map(function (sStatus) {
				return {
					status: sStatus,
					text: this.getText(TeamLeave.STATUS[sStatus].textKey) + "  " + fnCount(sStatus),
					selected: oLeaveView.status === sStatus
				};
			}, this));

			var aRows = aInScope.filter(function (oRequest) {
				return oRequest.status === oLeaveView.status;
			}).sort(function (a, b) {
				// What is waiting, soonest first; what is decided, latest first.
				return oLeaveView.status === "REQ" ? a.from.localeCompare(b.from) : b.from.localeCompare(a.from);
			});
			oModel.setProperty("/rows", aRows);

			var bMyTeam = this.getModel("tcView").getProperty("/team") === "mine";
			var sPeriod = oPeriod ? formatter.dateRange(oPeriod.from, oPeriod.to) : this.getText("tlSelectDates");
			oModel.setProperty("/countText", this.getText(bMyTeam ? "tlCountMine" : "tlCount", [
				this.getText(aRows.length === 1 ? "tlOneRequest" : "tlRequests", [aRows.length]), sPeriod]));
			oModel.setProperty("/noDataText", oLeaveView.status === "REQ"
				? this.getText("tlNothingPending")
				: this.getText("tlNothingDecided", [this.getText(TeamLeave.STATUS[oLeaveView.status].textKey).toLowerCase()]));
		},

		/* =========================================================== */
		/* periods                                                     */
		/* =========================================================== */

		/**
		 * @returns {{from: Date, to: Date}} the days the calendar shows
		 */
		_calendarPeriod: function () {
			var oViewModel = this.getModel("tcView");
			var oStart = formatter.toDate(oViewModel.getProperty("/startDate")) || new Date();
			if (oViewModel.getProperty("/viewKey") === "month") {
				return { from: this._firstOfMonth(oStart), to: new Date(oStart.getFullYear(), oStart.getMonth() + 1, 0) };
			}
			return { from: oStart, to: new Date(oStart.getFullYear(), oStart.getMonth(), oStart.getDate() + 6) };
		},

		/**
		 * @returns {{from: Date, to: Date}|null} the Team leave period, or null while a
		 * custom range is still being picked
		 */
		_leavePeriod: function () {
			var oLeaveView = this.getModel("tlView").getData();
			if (oLeaveView.period === "custom") {
				return oLeaveView.rangeFrom && oLeaveView.rangeTo ? { from: oLeaveView.rangeFrom, to: oLeaveView.rangeTo } : null;
			}
			return this.getModel("tl").getProperty("/periods").filter(function (oPeriod) {
				return oPeriod.key === oLeaveView.period;
			})[0] || null;
		},

		/* =========================================================== */
		/* Team leave events                                           */
		/* =========================================================== */

		onPeriodChange: function () {
			if (this.getModel("tlView").getProperty("/period") === "custom") {
				if (this._leavePeriod()) {
					this._loadRequests();
				} else {
					this._renderLeave();
					var oRange = this.byId("teamLeaveRange");
					setTimeout(function () {
						oRange.focus();
					}, 0);
				}
				return;
			}
			this._loadRequests();
		},

		onRangeChange: function (oEvent) {
			if (oEvent.getParameter("valid") && oEvent.getParameter("from") && oEvent.getParameter("to")) {
				this._loadRequests();
			}
		},

		onLeaveSearch: function () {
			this._renderLeave();
		},

		onStatusChip: function (oEvent) {
			this.getModel("tlView").setProperty("/status", oEvent.getSource().data("status"));
			this._renderLeave();
		},

		onApproveRow: function (oEvent) {
			var oRequest = oEvent.getSource().getBindingContext("tl").getObject();
			this._approve([oRequest], oRequest.Name);
		},

		onRejectRow: function (oEvent) {
			var oRequest = oEvent.getSource().getBindingContext("tl").getObject();
			this._reject([oRequest], oRequest.Name);
		},

		/**
		 * Moves the calendar to the week the request starts in (its first weekday) and
		 * opens it there.
		 * @param {sap.ui.base.Event} oEvent the row press event
		 */
		onLeaveRowPress: function (oEvent) {
			var oRequest = oEvent.getSource().getBindingContext("tl").getObject();
			var oFirstDay = formatter.toDate(oRequest.from);
			while (oFirstDay.getDay() === 0 || oFirstDay.getDay() === 6) {
				oFirstDay.setDate(oFirstDay.getDate() + 1);
			}

			this._sSelectedRequestKey = oRequest.key;
			this._applyView("week", oFirstDay);
			this._loadCalendar().then(function () {
				var oCard = this.byId("teamCalCard");
				if (oCard && oCard.getDomRef()) {
					oCard.getDomRef().scrollIntoView({ block: "start", behavior: "smooth" });
				}
				// After the scroll, so the pop-over opens beside the block where it now is.
				setTimeout(function () {
					this._openRequest(oRequest, this._appointmentOf(oRequest) || oEvent.getSource());
				}.bind(this), 350);
			}.bind(this));
		},

		/* =========================================================== */
		/* calendar events                                             */
		/* =========================================================== */

		onFilterChange: function () {
			this._renderCalendar();
			this._renderLeave();
		},

		/**
		 * Stepping back or forward moves by the calendar's own idea of a step - in
		 * month view, 31 days from wherever it is - so it is snapped back onto a whole
		 * week or a whole month.
		 * @param {sap.ui.base.Event} oEvent the startDateChange event
		 */
		onStartDateChange: function (oEvent) {
			var sViewKey = this._currentViewKey();
			var oNewStart = oEvent.getSource().getStartDate();

			if (sViewKey === "month") {
				oNewStart = this._snapMonthStep(formatter.toDate(this.getModel("tcView").getProperty("/startDate")), oNewStart);
			}
			this._sSelectedRequestKey = "";
			this._applyView(sViewKey, oNewStart);
			this._loadCalendar();
		},

		onViewChange: function (oEvent) {
			this._applyView(oEvent.getSource().getViewKey(), formatter.toDate(this.getModel("tcView").getProperty("/startDate")));
			this._loadCalendar();
		},

		/**
		 * Opens the request behind a leave block. A bank holiday has none.
		 * @param {sap.ui.base.Event} oEvent the appointmentSelect event
		 */
		onAppointmentSelect: function (oEvent) {
			var oAppointment = oEvent.getParameter("appointment");
			var oContext = oAppointment && oAppointment.getBindingContext("tc");
			var oDay = oContext && oContext.getObject();
			var oRequest = oDay && oDay.leaveId && this._requestsByLeaveId()[oDay.leaveId];
			if (!oRequest) {
				return;
			}
			this._sSelectedRequestKey = oRequest.key;
			this._openRequest(oRequest, oAppointment);
		},

		/**
		 * Opens a person's pending requests from "N pending" under their name.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onPersonPendingPress: function (oEvent) {
			var oButton = oEvent.getSource();
			var oPerson = oButton.getBindingContext("tc").getObject();
			var aPending = this._pendingOf(oPerson.EmpID);
			if (!aPending.length) {
				return;
			}

			this.getModel("tcPop").setData({
				kind: "person",
				saving: false,
				name: oPerson.Name,
				initials: oPerson.initials,
				pending: aPending,
				pendingText: this.getText(aPending.length === 1 ? "tlOnePendingRequest" : "tlPendingRequests", [aPending.length]),
				approveAllText: aPending.length > 1 ? this.getText("tlApproveAllCount", [aPending.length]) : this.getText("tcApproveAll"),
				rejectAllText: aPending.length > 1 ? this.getText("tlRejectAllCount", [aPending.length]) : this.getText("tcRejectAll")
			});
			this._openPopover(oButton);
		},

		/* =========================================================== */
		/* the pop-over                                                */
		/* =========================================================== */

		/**
		 * @param {object} oRequest the request to show
		 * @param {sap.ui.core.Control} oAnchor what the pop-over opens beside
		 */
		_openRequest: function (oRequest, oAnchor) {
			var bManager = this.getModel("tcView").getProperty("/isManager");
			var aPending = this._pendingOf(oRequest.EmpID);
			var bUpcoming = oRequest.from > this._isoDate(new Date());

			this.getModel("tcPop").setData({
				kind: "request",
				saving: false,
				request: oRequest,
				pending: aPending,
				canAct: bManager && oRequest.status === "REQ",
				allPendingText: this.getText("tlAllPendingFor", [aPending.length, oRequest.FirstName]),
				// A manager can cancel leave that has not started; what is taken is history.
				cancellable: bManager && bUpcoming && (oRequest.status === "REQ" || oRequest.status === "APR")
			});
			this._openPopover(oAnchor);
		},

		_openPopover: function (oAnchor) {
			if (!this._pPopover) {
				this._pPopover = Fragment.load({
					id: this.getView().getId(),
					name: "bsx.hrx.hrx2026.fragment.TeamLeavePopover",
					controller: this
				}).then(function (oPopover) {
					this.getView().addDependent(oPopover);
					return oPopover;
				}.bind(this));
			}
			return this._pPopover.then(function (oPopover) {
				oPopover.openBy(oAnchor);
			});
		},

		_closePopover: function () {
			if (this._pPopover) {
				this._pPopover.then(function (oPopover) {
					oPopover.close();
				});
			}
		},

		onPopApprove: function () {
			var oRequest = this.getModel("tcPop").getProperty("/request");
			this._approve([oRequest], oRequest.Name);
		},

		onPopReject: function () {
			var oRequest = this.getModel("tcPop").getProperty("/request");
			this._reject([oRequest], oRequest.Name);
		},

		onPopApproveAll: function () {
			var oPop = this.getModel("tcPop").getData();
			this._approve(oPop.pending, oPop.kind === "person" ? oPop.name : oPop.request.Name);
		},

		onPopRejectAll: function () {
			var oPop = this.getModel("tcPop").getData();
			this._reject(oPop.pending, oPop.kind === "person" ? oPop.name : oPop.request.Name);
		},

		onPopApproveOne: function (oEvent) {
			var oRequest = oEvent.getSource().getBindingContext("tcPop").getObject();
			this._approve([oRequest], oRequest.Name);
		},

		onPopRejectOne: function (oEvent) {
			var oRequest = oEvent.getSource().getBindingContext("tcPop").getObject();
			this._reject([oRequest], oRequest.Name);
		},

		/* =========================================================== */
		/* deciding and cancelling                                     */
		/* =========================================================== */

		/**
		 * @param {Array<object>} aRequests the requests to approve
		 * @param {string} sName whose they are
		 */
		_approve: function (aRequests, sName) {
			this._decide(aRequests, "APR", "").then(function () {
				MessageToast.show(aRequests.length > 1
					? this.getText("tlApprovedMany", [aRequests.length, sName])
					: this.getText("mgrApprovedToast", [sName]));
			}.bind(this));
		},

		/**
		 * Asks for an optional note to the employee, then turns the requests down.
		 * @param {Array<object>} aRequests the requests to reject
		 * @param {string} sName whose they are
		 */
		_reject: function (aRequests, sName) {
			var bMany = aRequests.length > 1;
			var oNote = new TextArea({
				width: "100%",
				rows: 3,
				maxLength: 500,
				placeholder: this.getText("mgrDeclineNotePlaceholder")
			});
			var aLines = bMany
				? [new Text({ text: this.getText("tlDeclineManyIntro", [sName, aRequests.length]) })
					.addStyleClass("hrxResourceMeta sapUiTinyMarginBottom")].concat(aRequests.map(function (oRequest) {
					return new Text({ text: "• " + oRequest.dates + " · " + oRequest.type }).addStyleClass("hrxResourceMeta");
				}))
				: [new Text({ text: sName + " · " + aRequests[0].dates + " · " + aRequests[0].typeText })
					.addStyleClass("hrxResourceMeta")];

			this._closePopover();
			var oDialog = new Dialog({
				title: this.getText(bMany ? "tlDeclineManyTitle" : "mgrDeclineTitle"),
				contentWidth: "28rem",
				content: new VBox({
					items: aLines.concat([
						new Label({ text: this.getText("mgrDeclineNote"), labelFor: oNote }).addStyleClass("sapUiSmallMarginTop"),
						oNote
					])
				}).addStyleClass("sapUiSmallMargin"),
				beginButton: new Button({
					text: this.getText(bMany ? "tcRejectAll" : "btnReject"),
					type: "Reject",
					press: function () {
						var sNote = oNote.getValue().trim();
						oDialog.close();
						this._decide(aRequests, "REJ", sNote).then(function () {
							MessageToast.show(bMany
								? this.getText("tlDeclinedMany", [aRequests.length, sName])
								: this.getText("mgrDeclinedToast", [sName]));
						}.bind(this));
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
		 * Saves a decision and reloads the page. A failure is reported here.
		 * @param {Array<object>} aRequests the requests
		 * @param {string} sStatus "APR" or "REJ"
		 * @param {string} sNote the approver's note
		 * @returns {Promise} resolved once saved and reloaded; never rejected
		 */
		_decide: function (aRequests, sStatus, sNote) {
			var oProfile = this._oProfile || {};
			this.getModel("tcPop").setProperty("/saving", true);
			this.getModel("tlView").setProperty("/busy", true);

			return TeamLeave.decide(aRequests, sStatus, sNote, {
				orgId: this._sOrgId,
				empID: oProfile.empID,
				name: oProfile.name,
				email: oProfile.email
			}).then(function () {
				this._closePopover();
				this._sSelectedRequestKey = "";
				return Promise.all([this._loadCalendar(), this._loadRequests()]);
			}.bind(this)).catch(function (oError) {
				this.getModel("tcPop").setProperty("/saving", false);
				this.getModel("tlView").setProperty("/busy", false);
				this._showError("tcErrorApprovalAction", oError);
				return Promise.reject(oError);
			}.bind(this));
		},

		/**
		 * Cancels a request that has not started, once confirmed, and offers an email
		 * draft to the employee.
		 */
		onPopCancel: function () {
			var oRequest = this.getModel("tcPop").getProperty("/request");
			var sCancel = this.getText("lmCancelLeave");
			var sKeep = this.getText("lmKeepLeave");

			this._closePopover();
			MessageBox.confirm(this.getText("lmConfirmCancel", [oRequest.Name, oRequest.dates, oRequest.typeText]), {
				title: sCancel,
				icon: MessageBox.Icon.WARNING,
				actions: [sCancel, sKeep],
				emphasizedAction: sKeep,
				onClose: function (sAction) {
					if (sAction !== sCancel) {
						return;
					}
					TeamLeave.cancel(oRequest).then(function () {
						this._offerCancelEmail(oRequest);
					}.bind(this)).catch(function (oError) {
						this._showError("lmErrorCancel", oError);
					}.bind(this)).then(function () {
						// Some days may have gone before a failure; show what is left.
						this._sSelectedRequestKey = "";
						return Promise.all([this._loadCalendar(), this._loadRequests()]);
					}.bind(this));
				}.bind(this)
			});
		},

		/**
		 * Says the leave was cancelled and offers an Outlook draft to the employee.
		 * Nothing is sent unless the manager sends the draft.
		 * @param {object} oRequest the cancelled request
		 */
		_offerCancelEmail: function (oRequest) {
			var sTell = this.getText("lmLetThemKnow");

			MessageBox.success(this.getText("lmCancelled", [oRequest.Name, oRequest.dates]), {
				actions: oRequest.Email ? [sTell, MessageBox.Action.CLOSE] : [MessageBox.Action.CLOSE],
				emphasizedAction: oRequest.Email ? sTell : MessageBox.Action.CLOSE,
				onClose: function (sAction) {
					if (sAction !== sTell) {
						return;
					}
					Mail.open({
						to: oRequest.Email,
						subject: this.getText("lmCancelSubject", [oRequest.dates]),
						body: this.getText("lmCancelBody", [
							oRequest.FirstName,
							oRequest.type,
							oRequest.dates,
							oRequest.daysText,
							(this._oProfile || {}).name || ""
						])
					});
				}.bind(this)
			});
		},

		/* =========================================================== */
		/* book leave (shared with Manage Resources, see BookLeave.js) */
		/* =========================================================== */

		/**
		 * Book leave for someone: a manager's direct reports, or anyone with full access.
		 */
		onOpenBookLeave: function () {
			var sMe = this.getModel("tcView").getProperty("/myEmpId");
			var bEveryone = CurrentUser.hasFullAccess();
			var aEmployees = this._oReferences.list.filter(function (oPerson) {
				return oPerson.IsActive && (bEveryone || oPerson.ManagerID === sMe);
			}).map(function (oPerson) {
				return { EmpID: oPerson.EmpID, EmpName: oPerson.Name, EmpEmail: oPerson.Email, SiteID: oPerson.SiteID };
			});

			if (!aEmployees.length) {
				MessageBox.information(this.getText("lmNoReports"));
				return;
			}
			this.openBookLeave(null, aEmployees);
		},

		_afterBookLeave: function () {
			return Promise.all([this._loadCalendar(), this._loadRequests()]);
		},

		/* =========================================================== */
		/* calendar periods                                            */
		/* =========================================================== */

		/**
		 * @returns {string} the key of the view the calendar is showing
		 */
		_currentViewKey: function () {
			var oCalendar = this.byId("teamPlanningCalendar");
			return (oCalendar && oCalendar.getViewKey()) || "week";
		},

		/**
		 * Puts the calendar on the whole period its view is named after: a week from its
		 * Monday, or a month from the 1st and exactly as many columns wide as it has days.
		 * @param {string} sViewKey "week" or "month"
		 * @param {Date} [oAnchor] a day inside the period to show, today by default
		 */
		_applyView: function (sViewKey, oAnchor) {
			var oViewModel = this.getModel("tcView");
			var oCalendar = this.byId("teamPlanningCalendar");
			var oDate = oAnchor || new Date();
			var oStart = sViewKey === "month" ? this._firstOfMonth(oDate) : this._mondayOf(oDate);

			oViewModel.setProperty("/viewKey", sViewKey);
			oViewModel.setProperty("/startDate", oStart);
			if (!oCalendar) {
				return;
			}

			if (sViewKey === "month") {
				var iDays = new Date(oStart.getFullYear(), oStart.getMonth() + 1, 0).getDate();
				var oMonthView = this.byId("teamCalMonthView");
				oMonthView.setIntervalsL(iDays);
				oMonthView.setIntervalsM(iDays);
			}
			if (oCalendar.getViewKey() !== sViewKey) {
				oCalendar.setViewKey(sViewKey);
			}
			oCalendar.setStartDate(oStart);
		},

		/**
		 * Reads a month-view step as the month it was meant to reach: back from
		 * 1 October by 31 days is 31 August, which would skip September.
		 * @param {Date} oOldStart where the calendar was
		 * @param {Date} oNewStart where it says it is going
		 * @returns {Date} the first day of the month that step was meant to reach
		 */
		_snapMonthStep: function (oOldStart, oNewStart) {
			if (!oOldStart || !oNewStart) {
				return oNewStart;
			}
			var iDaysBack = Math.round((oOldStart.getTime() - oNewStart.getTime()) / (24 * 60 * 60 * 1000));
			var iDaysInOldMonth = new Date(oOldStart.getFullYear(), oOldStart.getMonth() + 1, 0).getDate();
			if (iDaysBack > 0 && iDaysBack <= iDaysInOldMonth) {
				return new Date(oOldStart.getFullYear(), oOldStart.getMonth() - 1, 1);
			}
			return oNewStart;
		},

		/**
		 * @param {object} oRequest a request
		 * @returns {sap.ui.unified.CalendarAppointment|null} its first block on the calendar
		 */
		_appointmentOf: function (oRequest) {
			var oCalendar = this.byId("teamPlanningCalendar");
			var oFound = null;
			oCalendar.getRows().some(function (oRow) {
				return oRow.getAppointments().some(function (oAppointment) {
					var oContext = oAppointment.getBindingContext("tc");
					if (oContext && oContext.getProperty("requestKey") === oRequest.key) {
						oFound = oAppointment;
						return true;
					}
					return false;
				});
			});
			return oFound && oFound.getDomRef() ? oFound : null;
		},

		_firstOfMonth: function (oDate) {
			return new Date(oDate.getFullYear(), oDate.getMonth(), 1);
		},

		/**
		 * @param {Date} oDate any day
		 * @returns {Date} the Monday of that day's week
		 */
		_mondayOf: function (oDate) {
			var oMonday = new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate());
			oMonday.setDate(oMonday.getDate() - ((oMonday.getDay() + 6) % 7));
			return oMonday;
		},

		/* =========================================================== */
		/* helpers (BookLeave.js relies on these too)                  */
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

		_isoDate: function (vDate) {
			return Backend.isoDate(formatter.toDate(vDate));
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
				details: (oError && oError.message) || (oError ? String(oError) : "")
			});
		}
	}));
});
