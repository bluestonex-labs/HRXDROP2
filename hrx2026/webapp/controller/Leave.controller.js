sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Fragment",
	"sap/ui/core/format/DateFormat",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageToast",
	"sap/m/MessageBox",
	"../model/Backend",
	"../model/CurrentUser",
	"../model/formatter"
], function (Controller, Fragment, DateFormat, JSONModel, Filter, FilterOperator,
	MessageToast, MessageBox, Backend, CurrentUser, formatter) {
	"use strict";

	// Root path of the backend services - see xs-app.json (deployed) and ui5.yaml (local).
	var LEAVE_SERVICE = Backend.LEAVE;

	// The leave type codes the service hands back (LeaveTypeID). The calendar and the
	// table write the code to the DOM as data-leave; leave.css holds the colours.
	var BANK_HOLIDAY = "BANK";

	// Duration choices on the request card, and the day slot each one books.
	var DURATION_SLOT = { F: "F", A: "A", P: "P" };
	var PER_DAY = "M";

	// How the table names a day's absence (the design's grey duration chip).
	var ABSENCE_TEXT_KEY = {
		"Full Day": "mlDurationFullSingle",
		"AM": "mlDurationAm",
		"PM": "mlDurationPm"
	};

	var oMonthTitleFormat = DateFormat.getDateInstance({ pattern: "MMMM yyyy" });
	var oMonthNameFormat = DateFormat.getDateInstance({ pattern: "MMMM" });
	var oShortMonthFormat = DateFormat.getDateInstance({ pattern: "MMM" });

	return Controller.extend("bsx.hrx.hrx2026.controller.Leave", {

		formatter: formatter,

		/* =========================================================== */
		/* lifecycle                                                   */
		/* =========================================================== */

		onInit: function () {
			// No lookup here: the signed-in user is still being resolved, and reading
			// the email now hands back "" on a browser refresh - which the services read
			// as "match anybody", so the page filled in with somebody else's details.
			// Everything waits on the profile in _onRouteMatched instead.
			this._sOrgId = CurrentUser.orgId(this.getOwnerComponent());
			this._sUserEmail = "";

			this.setModel(new JSONModel({
				busy: true,
				saving: false,
				currentEmail: "",
				statusFilter: "All",
				kpis: this._emptyKpis(),
				user: {}
			}), "mlView");

			this.setModel(new JSONModel({
				availedLeaves: [],
				requests: [],
				leaves: [],
				bankHolidays: [],
				leaveTypes: [],
				dates: []
			}), "ml");

			this.setModel(new JSONModel(this._emptyRequest()), "mlForm");
			this.setModel(new JSONModel({}), "mlEdit");

			// The Leave Calendar card and the Dates picker each show one month.
			this._oCalendarMonth = this._firstOfMonth(this._today());
			this.setModel(new JSONModel({ title: "", cells: [] }), "mlCal");
			this.setModel(new JSONModel({ title: "", hint: "", cells: [] }), "mlPicker");
			this._renderCalendar();

			// Picking "Choose per day" while it is already the choice fires no change,
			// so the list's own press reopens the per-day dialog. (The phone's view has
			// no Duration list.)
			var oDuration = this.byId("leaveDuration");
			if (oDuration && oDuration.getList) {
				oDuration.getList().attachItemPress(this._onDurationItemPress, this);
			}

			this.getOwnerComponent().getRouter().getRoute("leave")
				.attachPatternMatched(this._onRouteMatched, this);
		},

		/**
		 * "Choose per day" picked again: reopens the dialog on the days as they were
		 * chosen. A first pick is the change event's (onDurationChange), which opens it
		 * already - hence the check after the event has run its course.
		 * @param {sap.ui.base.Event} oEvent the list's itemPress event
		 */
		_onDurationItemPress: function (oEvent) {
			if (oEvent.getParameter("item").getKey() !== PER_DAY) {
				return;
			}
			setTimeout(function () {
				if (this.getModel("mlForm").getProperty("/Duration") === PER_DAY && !this._bHalfDaysOpen) {
					this._openHalfDays();
				}
			}.bind(this), 0);
		},

		/**
		 * The view is reused across navigations, so every entry reloads the balance and
		 * clears any half-finished request.
		 *
		 * Landing here straight from a browser refresh runs onInit while the profile
		 * lookup Component.js started is still in flight, so nothing may be fetched
		 * until it has landed - fetchUser with no email comes back for no one in
		 * particular, which is what put another person's quota and approver on screen.
		 */
		_onRouteMatched: function () {
			this.getModel("mlView").setProperty("/statusFilter", "All");
			this._resetRequestForm();

			return CurrentUser.ready(this.getOwnerComponent()).then(function (oProfile) {
				this._sUserEmail = oProfile.email;
				this._sOrgId = oProfile.orgId;
				this.getModel("mlView").setProperty("/currentEmail", this._sUserEmail);

				if (!this._sUserEmail) {
					this.getModel("mlView").setProperty("/busy", false);
					if (CurrentUser.shouldReportMissingIdentity()) {
						this._showError("mlErrorNoIdentity", null);
					}
					return undefined;
				}

				this._pLookupsLoaded = this._pLookupsLoaded || this._loadLookups();
				return this._pLookupsLoaded.then(this._loadUser.bind(this));
			}.bind(this));
		},

		/* =========================================================== */
		/* data loading                                                */
		/* =========================================================== */

		/**
		 * Loads the leave type value help. It is stable, so it is fetched once.
		 * @returns {Promise} resolved once the leave types are in the model
		 */
		_loadLookups: function () {
			var oModel = this.getModel("ml");

			return this._read("/LeaveTypes", {
				filters: [new Filter("OrgID", FilterOperator.EQ, this._sOrgId)]
			}).then(function (oData) {
				oModel.setProperty("/leaveTypes", this._strip(oData));
			}.bind(this)).catch(function (oError) {
				this._showError("mlErrorLookups", oError);
			}.bind(this));
		},

		/**
		 * Loads the quota, the leave taken so far and the bank holidays.
		 * @returns {Promise} resolved once the page is filled
		 */
		_loadUser: function () {
			var oViewModel = this.getModel("mlView");
			oViewModel.setProperty("/busy", true);

			return this._getJson(LEAVE_SERVICE + "?cmd=fetchUser&" + new URLSearchParams({
				Email: oViewModel.getProperty("/currentEmail"),
				OrgID: this._sOrgId
			}).toString()).then(function (oData) {
				var oUser = oData.user || {};
				var oModel = this.getModel("ml");

				oViewModel.setProperty("/user", oUser);
				oViewModel.setProperty("/kpis", {
					quota: oUser.annualLeaveQuota || "0",
					used: oUser.noOfAvailedLeaves || "0",
					balance: oUser.balanceLeaves || "0",
					allowanceText: this.getText("mlQuotaSub", [this._leaveYearStart()])
				});

				oModel.setProperty("/availedLeaves", oData.availedLeaves || []);
				oModel.setProperty("/bankHolidays", oData.bankHolidays || []);
				oModel.setProperty("/requests", this._groupRequests(oData.availedLeaves || []));

				this._applyStatusFilter();
				this._renderCalendar();
				oViewModel.setProperty("/busy", false);
			}.bind(this)).catch(function (oError) {
				oViewModel.setProperty("/busy", false);
				this.getModel("ml").setProperty("/availedLeaves", []);
				this.getModel("ml").setProperty("/requests", []);
				this._applyStatusFilter();
				this._renderCalendar();
				this._showError("mlErrorUser", oError);
			}.bind(this));
		},

		/**
		 * The service lists leave one day at a time, and keeps each day of a request
		 * as its own record, with the request's LeaveGrpID; the table shows one row
		 * per request, as the design does - "14 – 15 Jul 2026", not two rows. Days of
		 * one request that were decided differently stay apart, one row per status.
		 * The days arrive newest first, so the requests keep that order.
		 * @param {object[]} aDays the availedLeaves list from fetchUser
		 * @returns {object[]} one entry per request
		 */
		_groupRequests: function (aDays) {
			var aRequests = [];
			var mByKey = {};

			aDays.forEach(function (oDay) {
				var sKey = (oDay.LeaveGrpID || oDay.LeaveID) + "|" + oDay.StatusID;
				var oRequest = mByKey[sKey];
				if (!oRequest) {
					oRequest = {
						LeaveID: oDay.LeaveID,
						LeaveIDs: [],
						LeaveTypeID: oDay.LeaveTypeID,
						LeaveType: oDay.LeaveType,
						Absence: oDay.Absence,
						Status: oDay.Status,
						StatusID: oDay.StatusID,
						RequesterComments: oDay.RequesterComments,
						Dates: []
					};
					mByKey[sKey] = oRequest;
					aRequests.push(oRequest);
				}
				oRequest.Dates.push(oDay.Date);
				if (oRequest.LeaveIDs.indexOf(oDay.LeaveID) === -1) {
					oRequest.LeaveIDs.push(oDay.LeaveID);
				}
			});

			aRequests.forEach(function (oRequest) {
				oRequest.Dates.sort();
				oRequest.Date = oRequest.Dates[0];
				oRequest.DisplayRange = this._formatTableRange(oRequest.Dates[0], oRequest.Dates[oRequest.Dates.length - 1]);
				oRequest.DurationText = this.getText(ABSENCE_TEXT_KEY[oRequest.Absence] || "mlDurationFullSingle");
				// Only a request still awaiting a decision can be cancelled; the update
				// service rewrites a single date, so only a one-day request can be edited.
				oRequest.cancellable = oRequest.StatusID === "REQ";
				oRequest.editable = oRequest.StatusID === "REQ" && oRequest.Dates.length === 1;
			}, this);

			return aRequests;
		},

		/**
		 * Narrows the requests table to the status chosen in the filter.
		 */
		_applyStatusFilter: function () {
			var sStatus = this.getModel("mlView").getProperty("/statusFilter");
			var aAll = this.getModel("ml").getProperty("/requests") || [];

			this.getModel("ml").setProperty("/leaves", aAll.filter(function (oRequest) {
				return sStatus === "All" || oRequest.Status === sStatus;
			}));
		},

		onStatusFilter: function (oEvent) {
			this.getModel("mlView").setProperty("/statusFilter", oEvent.getParameter("item").getKey());
			this._applyStatusFilter();
		},

		onRefresh: function () {
			this._loadUser();
		},

		/* =========================================================== */
		/* leave calendar card                                         */
		/* =========================================================== */

		onCalendarPrevious: function () {
			this._oCalendarMonth = this._addMonths(this._oCalendarMonth, -1);
			this._renderCalendar();
		},

		onCalendarNext: function () {
			this._oCalendarMonth = this._addMonths(this._oCalendarMonth, 1);
			this._renderCalendar();
		},

		/**
		 * Fills the month grid: the weeks that hold the shown month, Monday first. A
		 * booked day carries its leave type (rejected leave is left off), a bank
		 * holiday is marked as such, and the tooltip says what the day is.
		 */
		_renderCalendar: function () {
			var oMonth = this._oCalendarMonth;
			var sToday = this._isoDate(this._today());
			var mLeave = {};

			(this.getModel("ml").getProperty("/availedLeaves") || []).forEach(function (oLeave) {
				if (oLeave.Status === "Rejected" || mLeave[oLeave.Date]) {
					return;
				}
				mLeave[oLeave.Date] = {
					leave: oLeave.LeaveTypeID || "OTHER",
					tooltip: oLeave.LeaveType + " (" + oLeave.Absence + ") — " + oLeave.Status
				};
			});
			(this.getModel("ml").getProperty("/bankHolidays") || []).forEach(function (oHoliday) {
				if (!mLeave[oHoliday.Date]) {
					mLeave[oHoliday.Date] = {
						leave: BANK_HOLIDAY,
						tooltip: oHoliday.Holiday || this.getText("tcLegendBankHoliday")
					};
				}
			}, this);

			var oFirst = this._mondayOnOrBefore(oMonth);
			var oLast = this._addDays(this._firstOfMonth(this._addMonths(oMonth, 1)), -1);
			var aCells = [];

			for (var oDay = oFirst; oDay <= oLast || aCells.length % 7 !== 0; oDay = this._addDays(oDay, 1)) {
				var sDate = this._isoDate(oDay);
				var oMark = mLeave[sDate];
				var aState = ["day"];

				if (oDay.getMonth() !== oMonth.getMonth()) {
					aState.push("muted");
				}
				if (oDay.getDay() === 0 || oDay.getDay() === 6) {
					aState.push("weekend");
				}
				if (sDate === sToday) {
					aState.push("today");
				}

				aCells.push({
					label: String(oDay.getDate()),
					state: aState.join(" "),
					leave: oMark ? oMark.leave : "none",
					tooltip: oMark ? oMark.tooltip : ""
				});
			}

			this.getModel("mlCal").setData({
				title: oMonthTitleFormat.format(oMonth),
				cells: aCells
			});
		},

		/* =========================================================== */
		/* dates picker (fragment/LeaveDatePicker)                     */
		/* =========================================================== */

		/**
		 * Opens the range picker under the Dates field, on the month of the start date
		 * already picked, or this month.
		 * @param {sap.ui.base.Event} oEvent the field's valueHelpRequest event
		 */
		onOpenDatePicker: function (oEvent) {
			var oInput = oEvent.getSource();

			// The picked range (this._oPickStart / _oPickEnd) is kept between openings,
			// as in the design; the next click after a finished range starts a new one.
			this._oPickerMonth = this._firstOfMonth(this._oPickStart || this._today());

			this._loadFragment("_pDatePicker", "bsx.hrx.hrx2026.fragment.LeaveDatePicker").then(function (oPopover) {
				this._renderPicker();
				if (oPopover.isOpen()) {
					oPopover.close();
				} else {
					oPopover.openBy(oInput);
				}
			}.bind(this));
		},

		onPickerPrevious: function () {
			this._oPickerMonth = this._addMonths(this._oPickerMonth, -1);
			this._renderPicker();
		},

		onPickerNext: function () {
			this._oPickerMonth = this._addMonths(this._oPickerMonth, 1);
			this._renderPicker();
		},

		/**
		 * The first click picks the start, the second the end (either way round). A
		 * click after a finished range starts a new one.
		 * @param {sap.ui.base.Event} oEvent the day button's press event
		 */
		onPickerDayPress: function (oEvent) {
			var oCell = oEvent.getSource().getBindingContext("mlPicker").getObject();
			var oDate = this._parseIsoDate(oCell.date);

			if (!this._oPickStart || this._oPickEnd) {
				this._oPickStart = oDate;
				this._oPickEnd = null;
				this._renderPicker();
				return;
			}

			if (oDate < this._oPickStart) {
				this._oPickEnd = this._oPickStart;
				this._oPickStart = oDate;
			} else {
				this._oPickEnd = oDate;
			}
			this._renderPicker();

			// Let the finished range show for a moment before the picker closes.
			setTimeout(function () {
				this._closeFragment("_pDatePicker");
			}.bind(this), 150);
			this._onRangePicked(this._oPickStart, this._oPickEnd);
		},

		/**
		 * Six weeks from the Monday on or before the 1st, as in the design's picker.
		 */
		_renderPicker: function () {
			var oMonth = this._oPickerMonth;
			var oToday = this._today();
			var oFirst = this._mondayOnOrBefore(oMonth);
			var aCells = [];

			for (var i = 0; i < 42; i++) {
				var oDay = this._addDays(oFirst, i);
				var bPast = oDay < oToday;
				var aState = ["day"];

				if (oDay.getMonth() !== oMonth.getMonth()) {
					aState.push("muted");
				}
				if (bPast) {
					aState.push("disabled");
				}
				if (this._sameDay(oDay, this._oPickStart)) {
					aState.push("range-start");
				}
				if (this._sameDay(oDay, this._oPickEnd)) {
					aState.push("range-end");
				}
				if (this._oPickStart && this._oPickEnd && oDay > this._oPickStart && oDay < this._oPickEnd) {
					aState.push("in-range");
				}

				aCells.push({
					date: this._isoDate(oDay),
					label: String(oDay.getDate()),
					state: aState.join(" "),
					enabled: !bPast,
					tooltip: bPast ? this.getText("mlPastDateTooltip") : ""
				});
			}

			this.getModel("mlPicker").setData({
				title: oMonthTitleFormat.format(oMonth),
				hint: this.getText(this._oPickStart && !this._oPickEnd ? "mlPickEndHint" : "mlPickStartHint"),
				cells: aCells
			});
		},

		/* =========================================================== */
		/* new request                                                 */
		/* =========================================================== */

		/**
		 * A range has been picked: show it in the field and ask the service which of
		 * its days can actually be booked.
		 * @param {Date} oFrom first day
		 * @param {Date} oTo last day
		 */
		_onRangePicked: function (oFrom, oTo) {
			var oForm = this.getModel("mlForm");
			oForm.setProperty("/FromDate", oFrom);
			oForm.setProperty("/ToDate", oTo);
			oForm.setProperty("/DatesText", this._formatInputRange(oFrom, oTo));
			this._loadLeaveDates();
		},

		/**
		 * Asks the service which of the chosen days can actually be booked - weekends,
		 * bank holidays and days already taken drop out, and a part-booked day comes back
		 * with only its free half available.
		 * @returns {Promise} resolved once the days are in the model
		 */
		_loadLeaveDates: function () {
			var oForm = this.getModel("mlForm").getData();
			var oUser = this.getModel("mlView").getProperty("/user") || {};

			return this._getJson(LEAVE_SERVICE + "?cmd=getDates&" + new URLSearchParams({
				FromDate: this._isoDate(oForm.FromDate),
				ToDate: this._isoDate(oForm.ToDate),
				OrgID: this._sOrgId,
				SiteID: oUser.siteID || "",
				EmpID: oUser.empID || ""
			}).toString()).then(function (oData) {
				this.getModel("ml").setProperty("/dates", (oData.dates || []).map(function (oDay) {
					var sSlot = oDay.availableSlot;
					return Object.assign({}, oDay, {
						AvailableKey: sSlot === "AM" ? "A" : sSlot === "PM" ? "P" : "F",
						SelectedKey: sSlot === "AM" ? "A" : sSlot === "PM" ? "P" : "F",
						FullDayEnabled: sSlot === "",
						AMEnabled: sSlot === "" || sSlot === "AM",
						PMEnabled: sSlot === "" || sSlot === "PM"
					});
				}));
				// New dates: any per-day choices were for the old ones
				this._bPerDayChosen = false;
				this.getModel("mlForm").setProperty("/PerDayText", "");
				this._applyDuration();
			}.bind(this)).catch(function (oError) {
				this.getModel("ml").setProperty("/dates", []);
				this._updateDayCount();
				this._showError("mlErrorDates", oError);
			}.bind(this));
		},

		/**
		 * The Duration list. Full day / AM / PM applies to every day in the range;
		 * "Choose per day" opens the half day dialog.
		 * @param {sap.ui.base.Event} oEvent the select's change event
		 */
		onDurationChange: function (oEvent) {
			var sKey = oEvent.getParameter("selectedItem").getKey();

			if (sKey === PER_DAY) {
				if (!(this.getModel("ml").getProperty("/dates") || []).length) {
					MessageToast.show(this.getText("mlSelectDatesFirst"));
					this.getModel("mlForm").setProperty("/Duration", "F");
					return;
				}
				this._openHalfDays();
				return;
			}
			this._applyDuration();
		},

		/**
		 * "Choose per day": the first time, every day starts as a full day - not as
		 * whatever the range was set to before - except a day already half taken, which
		 * can only offer its free half. Opened again after its days were confirmed, it
		 * shows them as they were chosen. What was there before is kept either way, so
		 * Cancel can put it back.
		 */
		_openHalfDays: function () {
			var oModel = this.getModel("ml");
			var aDates = oModel.getProperty("/dates") || [];
			var bChosen = !!this._bPerDayChosen;

			// A copy of each day: the dialog's buttons change the days themselves
			this._oHalfDaysBefore = {
				dates: aDates.map(function (oDay) {
					return Object.assign({}, oDay);
				}),
				duration: bChosen ? PER_DAY : (this._sAppliedDuration || "F")
			};
			if (!bChosen) {
				oModel.setProperty("/dates", aDates.map(function (oDay) {
					return Object.assign({}, oDay, { SelectedKey: oDay.FullDayEnabled ? "F" : oDay.AvailableKey });
				}));
			}
			this._bHalfDaysOpen = true;
			this._openFragment("_pHalfDayDialog", "bsx.hrx.hrx2026.fragment.LeaveHalfDayDialog");
		},

		/**
		 * Sets every bookable day to the chosen duration. A day with only one half
		 * free keeps that half whatever is chosen - the service will not book more.
		 */
		_applyDuration: function () {
			var sSlot = DURATION_SLOT[this.getModel("mlForm").getProperty("/Duration")];
			var oModel = this.getModel("ml");

			if (sSlot) {
				// What Cancel in the per-day dialog goes back to
				this._sAppliedDuration = this.getModel("mlForm").getProperty("/Duration");
				// The whole range on one duration again: per-day choices are gone
				this._bPerDayChosen = false;
				this.getModel("mlForm").setProperty("/PerDayText", "");
				oModel.setProperty("/dates", (oModel.getProperty("/dates") || []).map(function (oDay) {
					var bAllowed = (sSlot === "F" && oDay.FullDayEnabled) ||
						(sSlot === "A" && oDay.AMEnabled) ||
						(sSlot === "P" && oDay.PMEnabled);
					return Object.assign({}, oDay, { SelectedKey: bAllowed ? sSlot : oDay.AvailableKey });
				}));
			}
			this._updateDayCount();
		},

		/**
		 * Half days count as 0.5 towards the request.
		 */
		_updateDayCount: function () {
			var aDates = this.getModel("ml").getProperty("/dates") || [];
			var fDays = aDates.reduce(function (fTotal, oDay) {
				return fTotal + (oDay.SelectedKey === "F" ? 1 : 0.5);
			}, 0);

			this.getModel("mlForm").setProperty("/NoOfDays", fDays);
		},

		onConfirmHalfDays: function () {
			// Opened again, the dialog shows these days as chosen
			this._bPerDayChosen = true;
			this._bHalfDaysOpen = false;
			this._updateDayCount();
			this._showPerDayText();
			this._closeFragment("_pHalfDayDialog");
		},

		/**
		 * Duration says what each day is once the days are chosen one by one - "Mon:
		 * full, Tue: AM, Wed: PM" - and "Choose per day…" otherwise.
		 */
		_showPerDayText: function () {
			var mSlot = { F: this.getText("mlFullDay").toLowerCase(), A: this.getText("mlAm"), P: this.getText("mlPm") };
			var sText = !this._bPerDayChosen ? "" : (this.getModel("ml").getProperty("/dates") || []).map(function (oDay) {
				var sDay = this._parseIsoDate(oDay.date).toLocaleDateString("en-GB", { weekday: "short" });
				return this.getText("mlPerDayEntry", [sDay, mSlot[oDay.SelectedKey] || ""]);
			}, this).join(", ");
			this.getModel("mlForm").setProperty("/PerDayText", sText);
		},

		/**
		 * Closes the per-day dialog and leaves the request as it was before it opened:
		 * the same duration, every day as it was. Escape does the same.
		 * @param {object} [oEscape] the dialog's escape handler promise, when Escape closed it
		 */
		onCancelHalfDays: function (oEscape) {
			var oBefore = this._oHalfDaysBefore;
			this._bHalfDaysOpen = false;
			if (oBefore) {
				this.getModel("ml").setProperty("/dates", oBefore.dates);
				this.getModel("mlForm").setProperty("/Duration", oBefore.duration);
				this._updateDayCount();
			}
			if (oEscape && oEscape.resolve) {
				oEscape.resolve();
			} else {
				this._closeFragment("_pHalfDayDialog");
			}
		},

		/**
		 * Submits the request for approval by the user's manager.
		 * @returns {Promise<boolean>|undefined} whether the request was sent (the phone's
		 * request page shows its confirmation on true); nothing when it was not valid
		 */
		onSubmitLeave: function () {
			var oForm = this.getModel("mlForm").getData();
			var oUser = this.getModel("mlView").getProperty("/user") || {};
			var aDates = this.getModel("ml").getProperty("/dates") || [];

			if (!oForm.FromDate || !oForm.ToDate) {
				MessageToast.show(this.getText("mlSelectDatesFirst"));
				return;
			}
			if (!aDates.length) {
				MessageToast.show(this.getText("mlNoBookableDays"));
				return;
			}
			if (!oForm.LeaveCategoryId) {
				MessageToast.show(this.getText("mlLeaveTypePlaceholder"));
				return;
			}
			if (parseFloat(oForm.NoOfDays) > parseFloat(oUser.balanceLeaves || 0) && oForm.LeaveCategoryId === "HOLIL") {
				MessageBox.warning(this.getText("mlWarnOverBalance", [oForm.NoOfDays, oUser.balanceLeaves]));
			}

			var sToday = this._isoDate(new Date());

			var aRequests = aDates.map(function (oDay) {
				return {
					OrgID: this._sOrgId,
					LeaveID: "",
					EmpID: oUser.empID,
					EmpName: oUser.name,
					EmpEmail: this.getModel("mlView").getProperty("/currentEmail"),
					EmpSite: oUser.siteID || "",
					IsPaid: oForm.LeaveCategoryId === "UNPDL" ? "N" : "Y",
					LeaveCategoryId: oForm.LeaveCategoryId,
					NoOfDays: "1",
					StartDate: oDay.date,
					EndDate: oDay.date,
					DayTime: oDay.SelectedKey === "A" ? "AM" : oDay.SelectedKey === "P" ? "PM" : "Full Day",
					CreatedBy: oUser.empID,
					CreatedOn: sToday,
					ApprovalRequired: "Y",
					ApproverID: oUser.managerID || "",
					ApproverName: oUser.managerName || "",
					ApproverEmail: oUser.managerEmail || "",
					Status: "REQ",
					ApprovedOn: "",
					ApprovedBy: "",
					RequesterComments: oForm.Comments || "",
					ApproverComments: ""
				};
			}, this);

			return this._save(LEAVE_SERVICE + "?cmd=requestLeave", { LeaveReqSet: aRequests },
				"mlRequested", "mlErrorRequest").then(function () {
					this._resetRequestForm();
					this.getModel("mlView").setProperty("/statusFilter", "All");
					return this._loadUser().then(function () {
						return true;
					});
				}.bind(this)).catch(function () {
					// reported by _save
					return false;
				});
		},

		_resetRequestForm: function () {
			this._bPerDayChosen = false;
			this.getModel("mlForm").setData(this._emptyRequest());
			this.getModel("ml").setProperty("/dates", []);
			this._oPickStart = null;
			this._oPickEnd = null;
		},

		/* =========================================================== */
		/* edit or cancel a request                                    */
		/* =========================================================== */

		/**
		 * A request still awaiting a decision opens the edit dialog.
		 * @param {sap.ui.base.Event} oEvent the row's press event
		 */
		onEditLeave: function (oEvent) {
			var oContext = oEvent.getSource().getBindingContext("ml");
			if (!oContext || oContext.getProperty("StatusID") !== "REQ") {
				return;
			}

			this.getModel("mlEdit").setData(Object.assign({}, oContext.getObject()));
			this._openFragment("_pEditLeaveDialog", "bsx.hrx.hrx2026.fragment.EditLeaveDialog");
		},

		onCloseEditLeave: function () {
			this._closeFragment("_pEditLeaveDialog");
		},

		onUpdateLeave: function () {
			var oLeave = this.getModel("mlEdit").getData();

			this._save(LEAVE_SERVICE + "?cmd=update", {
				OrgID: this._sOrgId,
				LeaveID: oLeave.LeaveID,
				Date: oLeave.Date,
				LeaveType: oLeave.LeaveTypeID,
				Absence: oLeave.Absence
			}, "mlUpdated", "mlErrorUpdate").then(function () {
				this._closeFragment("_pEditLeaveDialog");
				return this._loadUser();
			}.bind(this)).catch(function () { /* reported by _save */ });
		},

		/**
		 * The row's Cancel button: asks first (fragment/CancelLeaveDialog).
		 * @param {sap.ui.base.Event} oEvent the button's press event
		 */
		onCancelLeave: function (oEvent) {
			var oContext = oEvent.getSource().getBindingContext("ml");
			if (!oContext || oContext.getProperty("StatusID") !== "REQ") {
				return;
			}

			this.getModel("mlEdit").setData(Object.assign({}, oContext.getObject()));
			this._openFragment("_pCancelLeaveDialog", "bsx.hrx.hrx2026.fragment.CancelLeaveDialog");
		},

		onCloseCancelLeave: function () {
			this._closeFragment("_pCancelLeaveDialog");
		},

		/**
		 * Removes the request - every day of it: each day is its own record in the
		 * service, deleted by its LeaveID.
		 */
		onConfirmCancelLeave: function () {
			var oLeave = this.getModel("mlEdit").getData();
			var aPayloads = oLeave.LeaveIDs.map(function (sLeaveID) {
				return {
					OrgID: this._sOrgId,
					LeaveID: sLeaveID,
					Date: oLeave.Date,
					LeaveType: oLeave.LeaveTypeID,
					Absence: oLeave.Absence
				};
			}, this);

			this._saveEach(LEAVE_SERVICE + "?cmd=delete", aPayloads, "mlCancelled", "mlErrorDelete").then(function () {
				this._closeFragment("_pCancelLeaveDialog");
				return this._loadUser();
			}.bind(this)).catch(function () {
				// Reported by _saveEach; reload, as some days may already be gone.
				return this._loadUser();
			}.bind(this));
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

		_save: function (sUrl, oPayload, sSuccessKey, sErrorKey) {
			var oViewModel = this.getModel("mlView");
			oViewModel.setProperty("/saving", true);

			return this._request(sUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(oPayload)
			}).then(function (oResult) {
				oViewModel.setProperty("/saving", false);
				MessageToast.show(oResult.msg || this.getText(sSuccessKey));
				return oResult;
			}.bind(this)).catch(function (oError) {
				oViewModel.setProperty("/saving", false);
				this._showError(sErrorKey, oError);
				throw oError;
			}.bind(this));
		},

		/**
		 * _save for several records: posts each payload in turn, then reports once.
		 * @param {string} sUrl the service url
		 * @param {object[]} aPayloads one body per call
		 * @param {string} sSuccessKey the i18n key of the success toast
		 * @param {string} sErrorKey the i18n key of the error message
		 * @returns {Promise} settles when every call has been made, or the first fails
		 */
		_saveEach: function (sUrl, aPayloads, sSuccessKey, sErrorKey) {
			var oViewModel = this.getModel("mlView");
			oViewModel.setProperty("/saving", true);

			var pSaved = Promise.resolve();
			aPayloads.forEach(function (oPayload) {
				pSaved = pSaved.then(function () {
					return this._request(sUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(oPayload)
					});
				}.bind(this));
			}, this);

			return pSaved.then(function () {
				oViewModel.setProperty("/saving", false);
				MessageToast.show(this.getText(sSuccessKey));
			}.bind(this)).catch(function (oError) {
				oViewModel.setProperty("/saving", false);
				this._showError(sErrorKey, oError);
				throw oError;
			}.bind(this));
		},

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

		_request: function (sUrl, oInit) {
			// Through Backend, which answers from the HRX service where it can.
			return Backend.request(sUrl, oInit);
		},

		/**
		 * Loads a dialog or popover fragment once and keeps it as a dependent of the view.
		 * @param {string} sCacheKey the property the loading promise is kept under
		 * @param {string} sFragmentName the fragment's module name
		 * @returns {Promise<sap.ui.core.Control>} the fragment's root control
		 */
		_loadFragment: function (sCacheKey, sFragmentName) {
			if (!this[sCacheKey]) {
				this[sCacheKey] = Fragment.load({
					id: this.getView().getId(),
					name: sFragmentName,
					controller: this
				}).then(function (oControl) {
					this.getView().addDependent(oControl);
					return oControl;
				}.bind(this));
			}
			return this[sCacheKey];
		},

		_openFragment: function (sCacheKey, sFragmentName) {
			return this._loadFragment(sCacheKey, sFragmentName).then(function (oDialog) {
				oDialog.open();
				return oDialog;
			});
		},

		_closeFragment: function (sCacheKey) {
			if (this[sCacheKey]) {
				this[sCacheKey].then(function (oControl) {
					oControl.close();
				});
			}
		},

		_strip: function (oData) {
			return (oData.results || []).map(function (oRow) {
				var oCopy = Object.assign({}, oRow);
				delete oCopy.__metadata;
				return oCopy;
			});
		},

		/**
		 * @param {Date|string} vDate a date
		 * @returns {string} the date as yyyy-MM-dd in local time
		 */
		_isoDate: function (vDate) {
			var oDate = vDate instanceof Date ? vDate : formatter.toDate(vDate);
			if (!oDate) {
				return "";
			}
			var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
			var sDay = String(oDate.getDate()).padStart(2, "0");
			return oDate.getFullYear() + "-" + sMonth + "-" + sDay;
		},

		/**
		 * @param {string} sDate yyyy-MM-dd
		 * @returns {Date} that day at local midnight (new Date("yyyy-MM-dd") is UTC)
		 */
		_parseIsoDate: function (sDate) {
			var aParts = sDate.split("-");
			return new Date(Number(aParts[0]), Number(aParts[1]) - 1, Number(aParts[2]));
		},

		_today: function () {
			var oNow = new Date();
			return new Date(oNow.getFullYear(), oNow.getMonth(), oNow.getDate());
		},

		_firstOfMonth: function (oDate) {
			return new Date(oDate.getFullYear(), oDate.getMonth(), 1);
		},

		_addMonths: function (oDate, iMonths) {
			return new Date(oDate.getFullYear(), oDate.getMonth() + iMonths, 1);
		},

		_addDays: function (oDate, iDays) {
			return new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate() + iDays);
		},

		_mondayOnOrBefore: function (oDate) {
			return this._addDays(oDate, -((oDate.getDay() + 6) % 7));
		},

		_sameDay: function (oDate, oOther) {
			return !!oDate && !!oOther && this._isoDate(oDate) === this._isoDate(oOther);
		},

		/**
		 * The leave year runs April to March (see fetchUser in model/HrxLegacy.js), so
		 * the quota is the allowance of the year it started in.
		 * @returns {number} the leave year's first calendar year
		 */
		_leaveYearStart: function () {
			var oToday = this._today();
			return oToday.getMonth() < 3 ? oToday.getFullYear() - 1 : oToday.getFullYear();
		},

		/**
		 * @param {number} iDay day of the month
		 * @returns {string} "1st", "2nd", "13th"...
		 */
		_ordinal: function (iDay) {
			var iTens = iDay % 100;
			if (iTens >= 11 && iTens <= 13) {
				return iDay + "th";
			}
			switch (iDay % 10) {
				case 1:
					return iDay + "st";
				case 2:
					return iDay + "nd";
				case 3:
					return iDay + "rd";
				default:
					return iDay + "th";
			}
		},

		/**
		 * The Dates field, as the design writes it: "14th - 15th July 2026",
		 * "30th June - 2nd July 2026", or a single "14th July 2026".
		 * @param {Date} oFrom first day
		 * @param {Date} oTo last day
		 * @returns {string} the range for the field
		 */
		_formatInputRange: function (oFrom, oTo) {
			var fnDayMonth = function (oDate) {
				return this._ordinal(oDate.getDate()) + " " + oMonthNameFormat.format(oDate);
			}.bind(this);

			if (this._sameDay(oFrom, oTo)) {
				return fnDayMonth(oFrom) + " " + oFrom.getFullYear();
			}
			if (oFrom.getFullYear() !== oTo.getFullYear()) {
				return fnDayMonth(oFrom) + " " + oFrom.getFullYear() + " - " + fnDayMonth(oTo) + " " + oTo.getFullYear();
			}
			if (oFrom.getMonth() !== oTo.getMonth()) {
				return fnDayMonth(oFrom) + " - " + fnDayMonth(oTo) + " " + oTo.getFullYear();
			}
			return this._ordinal(oFrom.getDate()) + " - " + fnDayMonth(oTo) + " " + oTo.getFullYear();
		},

		/**
		 * The table's Date column, as the design writes it: "14 – 15 Jul 2026",
		 * "30 Jun – 2 Jul 2026", or a single "20 Jun 2026".
		 * @param {string} sFrom first day, yyyy-MM-dd
		 * @param {string} sTo last day, yyyy-MM-dd
		 * @returns {string} the range for the table
		 */
		_formatTableRange: function (sFrom, sTo) {
			var oFrom = this._parseIsoDate(sFrom);
			var oTo = this._parseIsoDate(sTo);
			var fnDayMonth = function (oDate) {
				return oDate.getDate() + " " + oShortMonthFormat.format(oDate);
			};

			if (sFrom === sTo) {
				return fnDayMonth(oFrom) + " " + oFrom.getFullYear();
			}
			if (oFrom.getFullYear() !== oTo.getFullYear()) {
				return fnDayMonth(oFrom) + " " + oFrom.getFullYear() + " – " + fnDayMonth(oTo) + " " + oTo.getFullYear();
			}
			if (oFrom.getMonth() !== oTo.getMonth()) {
				return fnDayMonth(oFrom) + " – " + fnDayMonth(oTo) + " " + oTo.getFullYear();
			}
			return oFrom.getDate() + " – " + fnDayMonth(oTo) + " " + oTo.getFullYear();
		},

		_emptyRequest: function () {
			return {
				FromDate: null,
				ToDate: null,
				DatesText: "",
				LeaveCategoryId: "HOLIL",
				Duration: "F",
				Comments: "",
				NoOfDays: 0
			};
		},

		_emptyKpis: function () {
			return { quota: "0", used: "0", balance: "0", allowanceText: "" };
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
					return oBody.msg || (oBody.error && oBody.error.message && oBody.error.message.value) || oError.responseText;
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
	});
});
