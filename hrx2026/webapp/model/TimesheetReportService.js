sap.ui.define([
	"./Hrx",
	"./HrxTime"
], function (Hrx, HrxTime) {
	"use strict";

	/*
	 * Where Timesheet Reporting gets its data: the HRX service, which holds every
	 * booking in one entity set (TimeLog). A period is four reads - the bookings, the
	 * projects with their clients, the assignments with their rates, and the people -
	 * however many employees there are.
	 *
	 * Bookings come back in the shape TimesheetReport works on:
	 *   { EmpID, Name, Email, ClientKey, ClientDesc, ProjectKey, ProjectDesc, PONo,
	 *     Billable, DayRate, Currency, entries: [{ RecID, Date, Minutes, Comment }] }
	 */

	return {

		/**
		 * Everybody, leavers included - their bookings still belong in a past period.
		 * @returns {Promise<Array<object>>} EmpID, Name, Email and IsActive of each
		 */
		loadPeople: function () {
			return HrxTime.people();
		},

		/**
		 * Every booking with time in the range.
		 * @param {Array<object>} aPeople from {@link loadPeople}
		 * @param {string} sOrgId unused - the service answers for the signed-in user's organisation
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @param {function} [fnProgress] called with (done, of) as each read lands
		 * @returns {Promise<object>} bookings, and failed (always empty: one read either
		 * answers for everyone or fails as a whole)
		 */
		loadBookings: function (aPeople, sOrgId, sFrom, sTo, fnProgress) {
			var iDone = 0;
			var fnStep = function (vResult) {
				iDone++;
				if (fnProgress) {
					fnProgress(iDone, 3);
				}
				return vResult;
			};

			if (fnProgress) {
				fnProgress(0, 3);
			}

			return Promise.all([
				HrxTime.timeLog(sFrom, sTo).then(fnStep),
				HrxTime.projects().then(fnStep),
				HrxTime.assignments().then(fnStep)
			]).then(function (aResults) {
				var aLog = aResults[0];
				var mProjects = aResults[1];
				var mRates = aResults[2];
				var mPeople = {};
				var mBookings = {};

				aPeople.forEach(function (oPerson) {
					mPeople[oPerson.EmpID] = oPerson;
				});

				aLog.forEach(function (oEntry) {
					var sEmpId = oEntry.Employee_EmployeeID;
					var sProject = oEntry.Project_ID;
					var sKey = sEmpId + "|" + sProject;
					var oBooking = mBookings[sKey];

					if (!oBooking) {
						var oPerson = mPeople[sEmpId] || { EmpID: sEmpId, Name: sEmpId, Email: "" };
						var oProject = mProjects[sProject] || { ProjectDesc: sProject, ClientKey: "", ClientDesc: "", PONumber: "" };
						var oRate = mRates[sKey] || { DayRate: 0, Currency: "GBP", Billable: false };

						oBooking = mBookings[sKey] = {
							EmpID: sEmpId,
							Name: oPerson.Name,
							Email: oPerson.Email,
							ClientKey: oProject.ClientKey,
							ClientDesc: oProject.ClientDesc,
							ProjectKey: sProject,
							ProjectDesc: oProject.ProjectDesc,
							PONo: oProject.PONumber,
							Billable: HrxTime.isBillable(oProject, oRate),
							DayRate: oRate.DayRate,
							Currency: oRate.Currency,
							entries: []
						};
					}

					oBooking.entries.push({
						RecID: oEntry.ID,
						Date: oEntry.Date,
						Minutes: HrxTime.minutes(oEntry.Hours),
						Comment: oEntry.Comment || ""
					});
				});

				return {
					bookings: Object.keys(mBookings).map(function (sKey) {
						return mBookings[sKey];
					}),
					failed: []
				};
			});
		},

		/**
		 * Hours booked against hours expected for everyone, over a range.
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @returns {Promise<Array<object>>} UserID, Name, Email, UserTypeKey,
		 * bookedMinutes, expectedMinutes and leaveMinutes
		 */
		loadWeek: function (sFrom, sTo) {
			return HrxTime.compliance(sFrom, sTo);
		}
	};
});
