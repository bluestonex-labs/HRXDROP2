sap.ui.define([
	"./Leave.controller",
	"sap/ui/model/json/JSONModel"
], function (Leave, JSONModel) {
	"use strict";

	// Holiday is the leave type the allowance is counted in (see fetchUser in
	// model/HrxLegacy.js); every other type leaves the balance as it is.
	var HOLIDAY = "HOLIL";

	// The status chips over the request list, as the prototype has them.
	var FILTERS = ["All", "Requested", "Approved", "Rejected"];

	// A request's pill, by its status code (as formatter.leaveStatusState reads them).
	var STATUS_PILL = { REQ: "warn", APR: "ok", APP: "ok", REJ: "crit" };

	/**
	 * My Leave on a phone, after the mobile prototype: the balance, the requests as
	 * cards with a status filter, and a full-screen request form with a calendar
	 * sheet. Loading, the dates check with the service, submitting and cancelling are
	 * the desktop page's own (Leave.controller); "mlp" holds what only the phone shows.
	 */
	return Leave.extend("bsx.hrx.hrx2026.controller.MobileLeave", {

		onInit: function () {
			this.setModel(new JSONModel({
				filters: [],
				page: false,
				done: null,
				sheet: false,
				sheetKind: "",
				sheetTitle: "",
				sheetText: "",
				calendarHint: "",
				calendarCanApply: false,
				check: { show: false, ok: false, message: "", days: 0, weekend: 0, balanceLabel: "", balanceText: "" },
				singleDay: false
			}), "mlp");
			Leave.prototype.onInit.apply(this, arguments);
		},

		/**
		 * Opens on the list; straight on the request form when Home's Request leave
		 * brought the user here.
		 */
		_onRouteMatched: function () {
			var oComponent = this.getOwnerComponent();
			var bOpenForm = !!oComponent._bPhoneOpenLeaveForm;

			oComponent._bPhoneOpenLeaveForm = false;
			this.getModel("mlp").setProperty("/sheet", false);
			this.getModel("mlp").setProperty("/page", false);

			return Promise.resolve(Leave.prototype._onRouteMatched.apply(this, arguments)).then(function () {
				if (bOpenForm) {
					this.onOpenRequest();
				}
			}.bind(this));
		},

		/**
		 * The requests as the desktop groups them, with what a card shows.
		 * @param {object[]} aDays the availedLeaves list from fetchUser
		 * @returns {object[]} one entry per request
		 */
		_groupRequests: function (aDays) {
			return Leave.prototype._groupRequests.apply(this, arguments).map(function (oRequest) {
				var fDays = oRequest.Absence === "AM" || oRequest.Absence === "PM" ?
					oRequest.Dates.length / 2 : oRequest.Dates.length;
				return Object.assign(oRequest, {
					days: fDays,
					subtitle: [oRequest.LeaveType, oRequest.DurationText, this._days(fDays)].join(" · "),
					pill: STATUS_PILL[oRequest.StatusID] || "neu"
				});
			}, this);
		},

		/**
		 * The status chips count from the whole list, whichever one is chosen.
		 */
		_applyStatusFilter: function () {
			Leave.prototype._applyStatusFilter.apply(this, arguments);

			var sChosen = this.getModel("mlView").getProperty("/statusFilter");
			var aAll = this.getModel("ml").getProperty("/requests") || [];

			this.getModel("mlp").setProperty("/filters", FILTERS.map(function (sKey) {
				return {
					key: sKey,
					text: this.getText("mbFilter" + sKey),
					count: aAll.filter(function (oRequest) {
						return sKey === "All" || oRequest.Status === sKey;
					}).length,
					on: sKey === sChosen
				};
			}, this));
		},

		onPhoneFilter: function (oEvent) {
			this.getModel("mlView").setProperty("/statusFilter", oEvent.getSource().getBindingContext("mlp").getProperty("key"));
			this._applyStatusFilter();
		},

		/* =========================================================== */
		/* cancel a request                                            */
		/* =========================================================== */

		onPhoneCancel: function (oEvent) {
			var oRequest = oEvent.getSource().getBindingContext("ml").getObject();
			var bHoliday = oRequest.LeaveTypeID === HOLIDAY;

			this.getModel("mlEdit").setData(Object.assign({}, oRequest));
			this._openSheet("cancel", this.getText("mbCancelRequest"), bHoliday ?
				this.getText("mbCancelRequestHoliday", [oRequest.LeaveType, oRequest.DisplayRange, this._days(oRequest.days)]) :
				this.getText("mbCancelRequestText", [oRequest.LeaveType, oRequest.DisplayRange]));
		},

		onPhoneConfirmCancel: function () {
			this.onCloseSheet();
			this.onConfirmCancelLeave();
		},

		/* =========================================================== */
		/* new request: the full-screen form                           */
		/* =========================================================== */

		onOpenRequest: function () {
			this._resetRequestForm();
			this.getModel("mlp").setProperty("/done", null);
			this._refreshCheck();
			this.getModel("mlp").setProperty("/page", true);
		},

		onCloseRequest: function () {
			var bDone = !!this.getModel("mlp").getProperty("/done");
			this.getModel("mlp").setProperty("/page", false);
			if (bDone) {
				this.getModel("mlView").setProperty("/statusFilter", "All");
				this._applyStatusFilter();
			}
		},

		onPickType: function (oEvent) {
			this.getModel("mlForm").setProperty("/LeaveCategoryId",
				oEvent.getSource().getBindingContext("ml").getProperty("LeaveCategoryId"));
			this._refreshCheck();
		},

		/**
		 * Full day, Morning or Afternoon - the half days only on a single working day.
		 * @param {sap.ui.base.Event} oEvent the segment's press event
		 */
		onPickDuration: function (oEvent) {
			this.getModel("mlForm").setProperty("/Duration", oEvent.getSource().data("duration"));
			this._applyDuration();
			this._refreshCheck();
		},

		/**
		 * After the dates check with the service, and whenever the type or the length
		 * changes: the working days, the weekend days left out, the balance after, and
		 * whatever stops the request going in.
		 */
		_refreshCheck: function () {
			var oForm = this.getModel("mlForm").getData();
			var aDates = this.getModel("ml").getProperty("/dates") || [];
			var oUser = this.getModel("mlView").getProperty("/user") || {};
			var fBalance = parseFloat(oUser.balanceLeaves) || 0;
			var fDays = parseFloat(oForm.NoOfDays) || 0;
			var bHoliday = oForm.LeaveCategoryId === HOLIDAY;
			var bPicked = !!oForm.FromDate && !!oForm.ToDate;

			var iCalendarDays = bPicked ? Math.round((this._parseIsoDate(this._isoDate(oForm.ToDate)) -
				this._parseIsoDate(this._isoDate(oForm.FromDate))) / 864e5) + 1 : 0;
			var iWeekdays = 0;
			for (var i = 0; i < iCalendarDays; i++) {
				var oDay = this._addDays(oForm.FromDate, i);
				if (oDay.getDay() !== 0 && oDay.getDay() !== 6) {
					iWeekdays++;
				}
			}

			var sMessage = "";
			if (bPicked && !aDates.length) {
				sMessage = this.getText("mbNoWorkingDays");
			} else if (bPicked && bHoliday && fDays > fBalance) {
				sMessage = this.getText("mbOverBalance", [fBalance]);
			}

			this.getModel("mlp").setProperty("/check", {
				show: bPicked,
				ok: bPicked && !!aDates.length && !sMessage && !!oForm.LeaveCategoryId,
				message: sMessage,
				days: fDays,
				weekend: iCalendarDays - iWeekdays,
				balanceLabel: this.getText(bHoliday ? "mbBalanceAfter" : "mbHolidayBalance"),
				balanceText: bHoliday ? this._days(fBalance - fDays) : this.getText("mbNotAffected")
			});
			// Half days are for a single working day; anything longer is whole days.
			var bSingle = aDates.length === 1;
			this.getModel("mlp").setProperty("/singleDay", bSingle);
			this.getModel("mlp").setProperty("/amEnabled", bSingle && !!aDates[0].AMEnabled);
			this.getModel("mlp").setProperty("/pmEnabled", bSingle && !!aDates[0].PMEnabled);
			if (!bSingle && oForm.Duration !== "F") {
				this.getModel("mlForm").setProperty("/Duration", "F");
				this._applyDuration();
			}
		},

		/**
		 * The service's answer on the chosen dates feeds the check.
		 * @returns {Promise} resolved once the days are in the model
		 */
		_loadLeaveDates: function () {
			return Leave.prototype._loadLeaveDates.apply(this, arguments).then(this._refreshCheck.bind(this));
		},

		onPhoneSubmit: function () {
			var oForm = this.getModel("mlForm").getData();
			var oUser = this.getModel("mlView").getProperty("/user") || {};
			var oType = (this.getModel("ml").getProperty("/leaveTypes") || []).filter(function (oCandidate) {
				return oCandidate.LeaveCategoryId === oForm.LeaveCategoryId;
			})[0];
			var fDays = parseFloat(oForm.NoOfDays) || 0;
			var bHoliday = oForm.LeaveCategoryId === HOLIDAY;
			var oSummary = {
				dates: this._formatTableRange(this._isoDate(oForm.FromDate), this._isoDate(oForm.ToDate)),
				type: oType ? oType.LeaveCategoryDesc : oForm.LeaveCategoryId,
				length: this._days(fDays),
				holiday: bHoliday,
				text: oUser.managerName ? this.getText("mbRequestSentText", [oUser.managerName]) : this.getText("mbRequestSentNoApprover")
			};

			Promise.resolve(this.onSubmitLeave()).then(function (bSent) {
				if (!bSent) {
					return;
				}
				var oNow = this.getModel("mlView").getProperty("/user") || {};
				oSummary.balance = this._days(parseFloat(oNow.balanceLeaves) || 0);
				this.getModel("mlp").setProperty("/done", oSummary);
			}.bind(this));
		},

		/* =========================================================== */
		/* the dates: a calendar sheet                                 */
		/* =========================================================== */

		onOpenPhoneDates: function () {
			// The range already chosen comes back with the sheet; the month is its first.
			var oForm = this.getModel("mlForm").getData();
			this._oPickStart = oForm.FromDate || null;
			this._oPickEnd = oForm.ToDate && oForm.FromDate && !this._sameDay(oForm.FromDate, oForm.ToDate) ? oForm.ToDate : null;
			this._oPickerMonth = this._firstOfMonth(this._oPickStart || this._today());
			this._renderPicker();
			this._openSheet("dates", this.getText("mbSelectDates"));
		},

		/**
		 * The prototype's picker: a tap starts a range, a second tap ends it, and Apply
		 * (not the second tap) takes it - a single day is a start and Apply.
		 * @param {sap.ui.base.Event} oEvent the day's press event
		 */
		onPhonePickDay: function (oEvent) {
			var oDate = this._parseIsoDate(oEvent.getSource().getBindingContext("mlPicker").getProperty("date"));

			if (!this._oPickStart || this._oPickEnd) {
				this._oPickStart = oDate;
				this._oPickEnd = null;
			} else if (oDate < this._oPickStart) {
				this._oPickStart = oDate;
			} else if (!this._sameDay(oDate, this._oPickStart)) {
				this._oPickEnd = oDate;
			}
			this._renderPicker();
		},

		onPhoneClearDates: function () {
			this._oPickStart = null;
			this._oPickEnd = null;
			this._renderPicker();
		},

		onPhoneApplyDates: function () {
			if (!this._oPickStart) {
				return;
			}
			this.onCloseSheet();
			this._onRangePicked(this._oPickStart, this._oPickEnd || this._oPickStart);
		},

		/**
		 * The desktop picker's month, with what the prototype adds: today, weekends, a
		 * dot on days already booked, and the range written out under it.
		 */
		_renderPicker: function () {
			Leave.prototype._renderPicker.apply(this, arguments);

			var sToday = this._isoDate(this._today());
			var mBooked = {};
			(this.getModel("ml").getProperty("/availedLeaves") || []).forEach(function (oLeave) {
				if (oLeave.Status !== "Rejected" && !mBooked[oLeave.Date]) {
					mBooked[oLeave.Date] = oLeave.LeaveTypeID || "OTHER";
				}
			});

			var oPicker = this.getModel("mlPicker");
			oPicker.setProperty("/cells", (oPicker.getProperty("/cells") || []).map(function (oCell) {
				var oDate = this._parseIsoDate(oCell.date);
				return Object.assign(oCell, {
					today: oCell.date === sToday,
					weekend: oDate.getDay() === 0 || oDate.getDay() === 6,
					booked: oCell.enabled ? (mBooked[oCell.date] || "") : ""
				});
			}, this));

			var sHint;
			if (!this._oPickStart) {
				sHint = this.getText("mbPickStart");
			} else if (!this._oPickEnd) {
				sHint = this.getText("mbPickEnd");
			} else {
				var iWorking = 0;
				for (var oDay = this._oPickStart; oDay <= this._oPickEnd; oDay = this._addDays(oDay, 1)) {
					if (oDay.getDay() !== 0 && oDay.getDay() !== 6) {
						iWorking++;
					}
				}
				sHint = this.getText("mbPickRange", [
					this._formatTableRange(this._isoDate(this._oPickStart), this._isoDate(this._oPickEnd)),
					this.getText(iWorking === 1 ? "mbWorkingDay" : "mbWorkingDayMany", [iWorking])
				]);
			}
			this.getModel("mlp").setProperty("/calendarHint", sHint);
			this.getModel("mlp").setProperty("/calendarCanApply", !!this._oPickStart);
		},

		/**
		 * @param {number} fDays a number of days, halves included
		 * @returns {string} "1 day", "2.5 days"
		 */
		_days: function (fDays) {
			return this.getText(fDays === 1 ? "mbDay" : "mbDayMany", [fDays]);
		},

		/* =========================================================== */
		/* bottom sheet                                                */
		/* =========================================================== */

		_openSheet: function (sKind, sTitle, sText) {
			var oModel = this.getModel("mlp");
			oModel.setProperty("/sheetKind", sKind);
			oModel.setProperty("/sheetTitle", sTitle);
			oModel.setProperty("/sheetText", sText || "");
			oModel.setProperty("/sheet", true);
		},

		onCloseSheet: function () {
			this.getModel("mlp").setProperty("/sheet", false);
		}
	});
});
