sap.ui.define([
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageToast",
	"../model/Backend",
	"../model/CurrentUser"
], function (JSONModel, Filter, FilterOperator, MessageToast, Backend, CurrentUser) {
	"use strict";

	var LEAVE_SERVICE = Backend.SERVICE_ROOT + "/hrx/leaveReqs.xsjs";

	/*
	 * Book leave on someone's behalf, approved straight away - shared by Manage
	 * Resources (for the resource on screen) and Leave management (for a chosen
	 * employee). Mixed into the controller, which provides _read, _getJson,
	 * _postJson, _openDialog, _closeDialog, _isoDate, getText, getModel, setModel,
	 * _showError and _sOrgId, and is told about each booking through
	 * _afterBookLeave(oForm).
	 *
	 * The dialog is fragment/ResourceBookLeaveDialog, bound to the "mrBook" model.
	 */
	return {

		/**
		 * @param {object} [oEmployee] who the leave is for: EmpID, EmpName, EmpEmail and
		 * SiteID. Leave it out to let the booker choose from aEmployees.
		 * @param {Array<object>} [aEmployees] the people the booker may choose from, in
		 * the same shape
		 */
		openBookLeave: function (oEmployee, aEmployees) {
			var oFor = oEmployee || {};

			this.setModel(new JSONModel({
				pickEmployee: !oEmployee,
				employees: aEmployees || [],
				EmpID: oFor.EmpID || "",
				EmpName: oFor.EmpName || "",
				EmpEmail: oFor.EmpEmail || "",
				SiteID: oFor.SiteID || "",
				LeaveCategoryId: "",
				Comments: "",
				leaveTypes: this._aLeaveTypes || [],
				dates: [],
				datesPicked: false,
				NoOfDays: 0,
				daysText: this.getText(oEmployee ? "mrBookLeavePickDates" : "lmBookPickEmployee"),
				saving: false
			}), "mrBook");

			if (!this._pLeaveTypes) {
				this._pLeaveTypes = this._read("/LeaveTypes", {
					filters: [new Filter("OrgID", FilterOperator.EQ, this._sOrgId)]
				}).then(function (oData) {
					this._aLeaveTypes = (oData.results || []).map(function (oType) {
						return { LeaveCategoryId: oType.LeaveCategoryId, LeaveCategoryDesc: oType.LeaveCategoryDesc };
					});
				}.bind(this)).catch(function (oError) {
					this._pLeaveTypes = null;
					this._showError("mrErrorLeaveTypes", oError);
				}.bind(this));
			}

			this._pLeaveTypes.then(function () {
				var oBook = this.getModel("mrBook");
				var aTypes = this._aLeaveTypes || [];
				var oHoliday = aTypes.filter(function (oType) {
					return oType.LeaveCategoryId === "HOLIL";
				})[0] || aTypes[0];
				oBook.setProperty("/leaveTypes", aTypes);
				oBook.setProperty("/LeaveCategoryId", oHoliday ? oHoliday.LeaveCategoryId : "");
			}.bind(this));

			this._openDialog("_pBookLeaveDialog", "bsx.hrx.hrx2026.fragment.ResourceBookLeaveDialog").then(function () {
				this.byId("resourceBookLeaveDates").setValue("");
			}.bind(this));
		},

		/**
		 * A different employee chosen: their bookable days differ, so the dates are
		 * worked out again.
		 * @param {sap.ui.base.Event} oEvent the selection change event
		 */
		onBookLeaveEmployeeChange: function (oEvent) {
			var oBook = this.getModel("mrBook");
			var oItem = oEvent.getParameter("selectedItem");
			var sEmpId = oItem ? oItem.getKey() : "";
			var oEmployee = (oBook.getProperty("/employees") || []).filter(function (oPerson) {
				return oPerson.EmpID === sEmpId;
			})[0] || {};

			oBook.setProperty("/EmpID", oEmployee.EmpID || "");
			oBook.setProperty("/EmpName", oEmployee.EmpName || "");
			oBook.setProperty("/EmpEmail", oEmployee.EmpEmail || "");
			oBook.setProperty("/SiteID", oEmployee.SiteID || "");

			var oDates = this.byId("resourceBookLeaveDates");
			this._loadBookDates(oDates.getDateValue(), oDates.getSecondDateValue());
		},

		/**
		 * Asks which of the chosen days can be booked: bank holidays, non-working days
		 * and days already taken drop out, and a half-taken day offers its free half.
		 * @param {sap.ui.base.Event} oEvent the date range change event
		 */
		onBookLeaveDatesChange: function (oEvent) {
			this._loadBookDates(oEvent.getSource().getDateValue(), oEvent.getSource().getSecondDateValue());
		},

		_loadBookDates: function (oFrom, oSecond) {
			var oBook = this.getModel("mrBook");
			var oTo = oSecond || oFrom;

			if (!oFrom || !oBook.getProperty("/EmpID")) {
				oBook.setProperty("/dates", []);
				oBook.setProperty("/datesPicked", !!oFrom);
				this._updateBookDays();
				return;
			}

			oBook.setProperty("/datesPicked", true);
			this._getJson(LEAVE_SERVICE + "?cmd=getDates&" + new URLSearchParams({
				FromDate: this._isoDate(oFrom),
				ToDate: this._isoDate(oTo),
				OrgID: this._sOrgId,
				SiteID: oBook.getProperty("/SiteID") || "",
				EmpID: oBook.getProperty("/EmpID")
			}).toString()).then(function (oData) {
				oBook.setProperty("/dates", (oData.dates || []).map(function (oDay) {
					var sSlot = oDay.availableSlot;
					return Object.assign({}, oDay, {
						SelectedKey: sSlot === "AM" ? "A" : sSlot === "PM" ? "P" : "F",
						FullDayEnabled: sSlot === "",
						AMEnabled: sSlot === "" || sSlot === "AM",
						PMEnabled: sSlot === "" || sSlot === "PM"
					});
				}));
				this._updateBookDays();
			}.bind(this)).catch(function (oError) {
				oBook.setProperty("/dates", []);
				this._updateBookDays();
				this._showError("mrErrorLeaveDates", oError);
			}.bind(this));
		},

		onBookLeaveDayChange: function () {
			this._updateBookDays();
		},

		_updateBookDays: function () {
			var oBook = this.getModel("mrBook");
			var aDates = oBook.getProperty("/dates") || [];
			var fDays = aDates.reduce(function (fTotal, oDay) {
				return fTotal + (oDay.SelectedKey === "F" ? 1 : 0.5);
			}, 0);

			oBook.setProperty("/NoOfDays", fDays);
			oBook.setProperty("/daysText", !oBook.getProperty("/EmpID") ? this.getText("lmBookPickEmployee") :
				!oBook.getProperty("/datesPicked") ? this.getText("mrBookLeavePickDates") :
					fDays ? this.getText(fDays === 1 ? "mrBookLeaveDay" : "mrBookLeaveDaysCount", [fDays]) :
						this.getText("mrBookLeaveNoDays"));
		},

		/**
		 * Books the leave on the employee's behalf, approved straight away - the same
		 * as a booking from the team calendar.
		 */
		onConfirmBookLeave: function () {
			var oBook = this.getModel("mrBook");
			var oForm = oBook.getData();
			var oProfile = CurrentUser.get() || {};
			var sToday = this._isoDate(new Date());

			oBook.setProperty("/saving", true);

			this._postJson(LEAVE_SERVICE + "?cmd=requestLeave", {
				LeaveReqSet: oForm.dates.map(function (oDay) {
					return {
						OrgID: this._sOrgId,
						LeaveID: "",
						EmpID: oForm.EmpID,
						EmpName: oForm.EmpName,
						EmpEmail: oForm.EmpEmail,
						EmpSite: oForm.SiteID || "",
						IsPaid: oForm.LeaveCategoryId === "UNPDL" ? "N" : "Y",
						LeaveCategoryId: oForm.LeaveCategoryId,
						NoOfDays: "1",
						StartDate: oDay.date,
						EndDate: oDay.date,
						DayTime: oDay.SelectedKey === "A" ? "AM" : oDay.SelectedKey === "P" ? "PM" : "Full Day",
						CreatedBy: oProfile.empID || "",
						CreatedOn: sToday,
						ApprovalRequired: "N",
						ApproverID: oProfile.empID || "",
						ApproverName: oProfile.name || "",
						ApproverEmail: oProfile.email || "",
						Status: "APR",
						ApprovedOn: sToday,
						ApprovedBy: oProfile.empID || "",
						RequesterComments: oForm.Comments || "",
						ApproverComments: ""
					};
				}, this)
			}).then(function () {
				oBook.setProperty("/saving", false);
				this._closeDialog("_pBookLeaveDialog");
				MessageToast.show(this.getText("mrLeaveBooked", [oForm.NoOfDays, oForm.EmpName]));
				return this._afterBookLeave(oForm);
			}.bind(this)).catch(function (oError) {
				oBook.setProperty("/saving", false);
				this._showError("mrErrorBookLeave", oError);
			}.bind(this));
		},

		onCancelBookLeave: function () {
			this._closeDialog("_pBookLeaveDialog");
		}
	};
});
