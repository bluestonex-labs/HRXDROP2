sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Fragment",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageBox",
	"../model/HrxLegacy",
	"../model/formatter"
], function (Controller, Fragment, JSONModel, MessageBox, HrxLegacy, formatter) {
	"use strict";

	return Controller.extend("bsx.hrx.hrx2026.controller.MissingTimesheets", {

		formatter: formatter,

		/* =========================================================== */
		/* lifecycle                                                   */
		/* =========================================================== */

		onInit: function () {
			this.setModel(new JSONModel({
				busy: true,
				weekStart: this._mondayOf(new Date()),
				weekLabel: "",
				periodLabel: "",
				userType: "S",
				title: this.getText("mtListTitle"),
				kpis: this._emptyKpis()
			}), "mtView");

			this.setModel(new JSONModel({ all: [], rows: [] }), "mt");

			this.getOwnerComponent().getRouter().getRoute("missingtimesheets")
				.attachPatternMatched(this._onRouteMatched, this);
		},

		/**
		 * The view is reused across navigations, so every entry reloads the report for
		 * the current week rather than showing a stale one.
		 */
		_onRouteMatched: function () {
			this.getModel("mtView").setProperty("/weekStart", this._mondayOf(new Date()));
			this._loadReport();
		},

		/* =========================================================== */
		/* data loading                                                */
		/* =========================================================== */

		/**
		 * Loads the report for the selected week, Monday to Sunday. The period ends
		 * today when the selected week is the current one, so people are not marked as
		 * missing time for days that have not happened yet.
		 * @returns {Promise} resolved once the report is in the model
		 */
		_loadReport: function () {
			var oViewModel = this.getModel("mtView");
			var oFirstDay = formatter.toDate(oViewModel.getProperty("/weekStart")) || this._mondayOf(new Date());
			var oToday = new Date();
			var oSunday = new Date(oFirstDay.getFullYear(), oFirstDay.getMonth(), oFirstDay.getDate() + 6);
			var bCurrentWeek = oToday >= oFirstDay && oToday <= new Date(oSunday.getFullYear(), oSunday.getMonth(), oSunday.getDate(), 23, 59, 59);
			var oLastDay = bCurrentWeek ? oToday : oSunday;

			oViewModel.setProperty("/busy", true);
			oViewModel.setProperty("/weekLabel", formatter.dateRange(oFirstDay, oSunday));
			oViewModel.setProperty("/isCurrentWeek", bCurrentWeek);
			oViewModel.setProperty("/periodLabel", this.getText("mtPeriod", [
				formatter.date(oFirstDay), formatter.date(oLastDay)
			]));

			return HrxLegacy.missingTimesheet(this._isoDate(oFirstDay), this._isoDate(oLastDay)).then(function (aData) {
				this.getModel("mt").setProperty("/all", (aData || []).map(this._toRow, this));
				this._applyFilter();
				oViewModel.setProperty("/busy", false);
			}.bind(this)).catch(function (oError) {
				oViewModel.setProperty("/busy", false);
				this.getModel("mt").setProperty("/all", []);
				this._applyFilter();
				this._showError("mtErrorReport", oError);
			}.bind(this));
		},

		/**
		 * Turns a service row into the shape the table binds against, deriving the
		 * completion percentage and its traffic-light state.
		 * @param {object} oUser one row of the report
		 * @returns {object} the display row
		 */
		_toRow: function (oUser) {
			var iExpected = parseInt(oUser.ExpectedBookingInSecond, 10) || 0;
			var iBooked = parseInt(oUser.ActualBookedInSecond, 10) || 0;
			var iMissing = parseInt(oUser.MissingTimeInSecond, 10) || 0;

			var iCompletion = (iBooked > 0 && iExpected > 0) ? Math.round(iBooked * 100 / iExpected) : 0;
			var sCompletionText;
			if (iBooked <= 0) {
				sCompletionText = this.getText("mtNotBooked");
			} else if (iCompletion >= 100) {
				sCompletionText = this.getText("mtComplete");
			} else {
				sCompletionText = iCompletion + "%";
			}

			return {
				OrgID: oUser.OrgID,
				UserID: oUser.UserID,
				FullName: ((oUser.FName || "") + " " + (oUser.LName || "")).trim(),
				FName: oUser.FName || "",
				LName: oUser.LName || "",
				Email: oUser.Email || "",
				Pic: oUser.Pic || "",
				UserTypeKey: oUser.UserTypeKey || "",
				BaseSiteKey: oUser.BaseSiteKey || "",
				ExpectedHours: this._toHoursAndMinutes(oUser.ExpectedBookingInHour),
				BookedHours: this._toHoursAndMinutes(oUser.ActualBookedInHour),
				LeaveHours: this._toHoursAndMinutes(oUser.LeaveTakenInHours),
				MissingHours: iMissing > 0 ? this._toHoursAndMinutes(oUser.MissingTimeInHour) : "",
				MissingSeconds: iMissing,
				Completion: Math.min(iCompletion, 100),
				CompletionText: sCompletionText,
				CompletionState: iCompletion < 75 ? "Error" : iCompletion < 90 ? "Warning" : "Success"
			};
		},

		/**
		 * Applies the resource type filter, sorts the worst offenders to the top and
		 * recalculates the header numbers.
		 */
		_applyFilter: function () {
			var oViewModel = this.getModel("mtView");
			var sUserType = oViewModel.getProperty("/userType");

			var aRows = (this.getModel("mt").getProperty("/all") || []).filter(function (oRow) {
				return sUserType === "ALL" || oRow.UserTypeKey === sUserType;
			}).sort(function (a, b) {
				return (b.MissingSeconds - a.MissingSeconds) || a.FullName.localeCompare(b.FullName);
			});

			var aDefaulters = aRows.filter(function (oRow) {
				return oRow.MissingSeconds > 0;
			});
			var iMissingSeconds = aDefaulters.reduce(function (iTotal, oRow) {
				return iTotal + oRow.MissingSeconds;
			}, 0);

			this.getModel("mt").setProperty("/rows", aRows);
			oViewModel.setProperty("/kpis", {
				resources: aRows.length,
				defaulters: aDefaulters.length,
				missingHours: this._secondsToHours(iMissingSeconds),
				defaulterState: aDefaulters.length ? "Error" : "Good"
			});
			oViewModel.setProperty("/title", this.getText("mtListTitleCount", [aRows.length]));
		},

		/* =========================================================== */
		/* events                                                      */
		/* =========================================================== */

		onUserTypeChange: function () {
			this._applyFilter();
		},

		onRefresh: function () {
			this._loadReport();
		},

		onPreviousWeek: function () {
			this._stepWeek(-7);
		},

		onNextWeek: function () {
			this._stepWeek(7);
		},

		_stepWeek: function (iDays) {
			var oViewModel = this.getModel("mtView");
			var oMonday = formatter.toDate(oViewModel.getProperty("/weekStart")) || this._mondayOf(new Date());

			this._showWeek(new Date(oMonday.getFullYear(), oMonday.getMonth(), oMonday.getDate() + iDays));
		},

		/**
		 * Opens the same week picker as My Timesheet: any day picked stands for its week.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onOpenWeekPicker: function (oEvent) {
			var oButton = oEvent.getSource();

			if (!this._pWeekPicker) {
				this._pWeekPicker = Fragment.load({
					id: this.getView().getId(),
					name: "bsx.hrx.hrx2026.fragment.WeekPickerPopover",
					controller: this
				}).then(function (oPopover) {
					this.getView().addDependent(oPopover);
					return oPopover;
				}.bind(this));
			}

			this._pWeekPicker.then(function (oPopover) {
				var oCalendar = this.byId("weekPickerCalendar");
				oCalendar.removeAllSelectedDates();
				oCalendar.focusDate(formatter.toDate(this.getModel("mtView").getProperty("/weekStart")));
				oPopover.openBy(oButton);
			}.bind(this));
		},

		onWeekPicked: function (oEvent) {
			var aSelected = oEvent.getSource().getSelectedDates();
			var oDate = aSelected.length && aSelected[0].getStartDate();
			if (!oDate) {
				return;
			}

			this._pWeekPicker.then(function (oPopover) {
				oPopover.close();
			});
			this._showWeek(this._mondayOf(oDate));
		},

		/**
		 * A week still to come has nothing to report but hours nobody could have
		 * booked yet, so the report stops at the current week.
		 * @param {Date} oMonday the Monday of the week to show
		 */
		_showWeek: function (oMonday) {
			var oThisMonday = this._mondayOf(new Date());
			this.getModel("mtView").setProperty("/weekStart", oMonday > oThisMonday ? oThisMonday : oMonday);
			this._loadReport();
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
		 * The service reports durations as "HH:mm:ss"; the seconds add nothing here.
		 * @param {string} sDuration a duration
		 * @returns {string} the duration without seconds
		 */
		_toHoursAndMinutes: function (sDuration) {
			if (!sDuration || sDuration === "None") {
				return "";
			}
			return String(sDuration).replace(/:\d{2}$/, "");
		},

		/**
		 * The KPI tile has little room, so the total is rounded to whole hours - the
		 * table still shows each person's missing time to the minute.
		 * @param {number} iSeconds total missing seconds
		 * @returns {string} whole hours
		 */
		_secondsToHours: function (iSeconds) {
			return String(Math.round(iSeconds / 3600));
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

		_isoDate: function (oDate) {
			var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
			var sDay = String(oDate.getDate()).padStart(2, "0");
			return oDate.getFullYear() + "-" + sMonth + "-" + sDay;
		},

		_emptyKpis: function () {
			return { resources: 0, defaulters: 0, missingHours: "0:00", defaulterState: "Good" };
		},

		_showError: function (sTextKey, oError) {
			MessageBox.error(this.getText(sTextKey), {
				details: (oError && oError.message) || String(oError)
			});
		}
	});
});
