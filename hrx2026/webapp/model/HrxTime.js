sap.ui.define([
	"./Hrx"
], function (Hrx) {
	"use strict";

	/*
	 * Reads and sums the HRX service shares between the reports: people, bookings,
	 * projects, rates, and how many hours each person was expected to book.
	 */

	var DAY_FLAGS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
	var DEFAULT_WEEK_MINUTES = 40 * 60;

	function iso(oDate) {
		return oDate.getFullYear() + "-" + String(oDate.getMonth() + 1).padStart(2, "0") + "-" +
			String(oDate.getDate()).padStart(2, "0");
	}

	function eachDay(sFrom, sTo) {
		var aDays = [];
		var aFrom = sFrom.split("-");
		var oDay = new Date(+aFrom[0], +aFrom[1] - 1, +aFrom[2]);
		while (iso(oDay) <= sTo) {
			aDays.push({ iso: iso(oDay), weekday: oDay.getDay() });
			oDay.setDate(oDay.getDate() + 1);
		}
		return aDays;
	}

	var HrxTime = {

		/** What a working day owes: 8 hours, everywhere time is due (see HrxLegacy scheduleOf). */
		WORKING_DAY_MINUTES: 8 * 60,


		/**
		 * @param {string} sTime "hh:mm" or "hh:mm:ss"
		 * @returns {number} minutes
		 */
		minutes: function (sTime) {
			if (!sTime) {
				return 0;
			}
			var aParts = String(sTime).split(":");
			return (parseInt(aParts[0], 10) || 0) * 60 + (parseInt(aParts[1], 10) || 0);
		},

		/**
		 * @returns {Promise<Array<object>>} everybody: EmpID, FirstName, LastName, Name, Email, IsActive,
		 * UserType, SiteID, ManagerID and weekMinutes (their weekly target)
		 */
		people: function () {
			return Hrx.list("Users", {
				$select: "EmployeeID,FirstName,LastName,WorkEmail,UserType,IsActive,BaseSite_ID,Manager_EmployeeID,TargetHrsPerWeek"
			}).then(function (aUsers) {
				return aUsers.map(function (oUser) {
					var sName = ((oUser.FirstName || "") + " " + (oUser.LastName || "")).trim();
					return {
						EmpID: oUser.EmployeeID,
						FirstName: oUser.FirstName || "",
						LastName: oUser.LastName || "",
						Name: sName || oUser.WorkEmail || oUser.EmployeeID,
						Email: (oUser.WorkEmail || "").toLowerCase(),
						IsActive: oUser.IsActive !== false,
						UserType: oUser.UserType || "",
						SiteID: oUser.BaseSite_ID || "",
						ManagerID: oUser.Manager_EmployeeID || "",
						weekMinutes: HrxTime.minutes(oUser.TargetHrsPerWeek) || DEFAULT_WEEK_MINUTES
					};
				}).sort(function (a, b) {
					return a.Name.localeCompare(b.Name);
				});
			});
		},

		/**
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @param {string} [sEmpId] one person only
		 * @returns {Promise<Array<object>>} TimeLog rows
		 */
		timeLog: function (sFrom, sTo, sEmpId) {
			var sFilter = "Date ge " + sFrom + " and Date le " + sTo +
				(sEmpId ? " and Employee_EmployeeID eq " + Hrx.literal(sEmpId) : "");
			return Hrx.list("TimeLog", {
				$filter: sFilter,
				$select: "ID,Date,Hours,Comment,Project_ID,Employee_EmployeeID"
			});
		},

		/**
		 * @returns {Promise<object>} projects by ID: ProjectDesc, ProjectType, PONumber,
		 * ClientKey, ClientDesc, IsActive, IsTimeBookingAllowed
		 */
		projects: function () {
			return Hrx.list("Projects", {
				$select: "ID,ProjectDesc,ProjectType,PONumber,IsActive,IsTimeBookingAllowed,ClientID_ID",
				$expand: "ClientID($select=ID,ClientName)"
			}).then(function (aProjects) {
				var mProjects = {};
				aProjects.forEach(function (oProject) {
					mProjects[oProject.ID] = {
						ProjectDesc: oProject.ProjectDesc || oProject.ID,
						ProjectType: oProject.ProjectType || "",
						PONumber: oProject.PONumber || "",
						ClientKey: oProject.ClientID_ID || "",
						ClientDesc: (oProject.ClientID && oProject.ClientID.ClientName) || "",
						IsActive: oProject.IsActive !== false,
						IsTimeBookingAllowed: oProject.IsTimeBookingAllowed !== false
					};
				});
				return mProjects;
			});
		},

		/**
		 * The rate each person is on for each project. A person can be on a project
		 * under more than one billing scheme; the highest day rate stands for the pair.
		 * @returns {Promise<object>} by "EmpID|ProjectID": DayRate, Currency, BillingDesc
		 */
		assignments: function () {
			return Hrx.list("UserToProject", {
				$expand: "BillingID($select=ID,BillingDesc,DayRate,Currency)"
			}).then(function (aRows) {
				var mRates = {};
				aRows.forEach(function (oRow) {
					var sKey = oRow.Employee_EmployeeID + "|" + oRow.Project_ID;
					var fRate = parseFloat(oRow.DayRate) || parseFloat(oRow.BillingID && oRow.BillingID.DayRate) || 0;
					if (!mRates[sKey] || fRate > mRates[sKey].DayRate) {
						mRates[sKey] = {
							DayRate: fRate,
							Currency: oRow.Currency || (oRow.BillingID && oRow.BillingID.Currency) || "GBP",
							BillingDesc: (oRow.BillingID && oRow.BillingID.BillingDesc) || ""
						};
					}
				});
				return mRates;
			});
		},

		/**
		 * Whether time on a project is billed to the client. The project type is a code:
		 * FXD (fixed bid) and TNM (time and materials) are billed; INT (internal) and
		 * FOC (free of charge) are not.
		 * @param {object} oProject from {@link projects}
		 * @returns {boolean} true for billable work
		 */
		isBillable: function (oProject) {
			// As the HRX service counts it (utilisation, bonus): every project is billable
			// except internal ones - and, here, free-of-charge ones.
			var sType = String(oProject && oProject.ProjectType || "").trim().toUpperCase();
			return !!sType && HrxTime.NON_BILLABLE_TYPES.indexOf(sType) === -1;
		},

		NON_BILLABLE_TYPES: ["INT", "FOC"],

		// Named as the design names them ("Time & materials", "Fixed price",
		// "Internal"); free of charge is a type the HRX service also holds.
		PROJECT_TYPES: [
			{ key: "TNM", text: "Time & materials" },
			{ key: "FXD", text: "Fixed price" },
			{ key: "INT", text: "Internal" },
			{ key: "FOC", text: "Free of charge" }
		],

		/**
		 * Hours booked against hours expected, per active person, over a range. Expected
		 * hours are the person's weekly target spread over the days they work, less
		 * bank holidays at their site and leave that was not rejected.
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @returns {Promise<Array<object>>} UserID, Name, Email, UserTypeKey, bookedMinutes,
		 * expectedMinutes and leaveMinutes
		 */
		compliance: function (sFrom, sTo) {
			return Promise.all([
				HrxTime.people(),
				Hrx.list("WorkSchedule"),
				HrxTime.timeLog(sFrom, sTo),
				HrxTime.leaves(sFrom, sTo),
				Hrx.list("BankHolidays", { $filter: "Date ge " + sFrom + " and Date le " + sTo, $select: "Date,Site_ID" })
			]).then(function (aResults) {
				var mSchedules = {};
				var mBooked = {};
				var mLeave = {};
				var mHolidays = {};

				aResults[1].forEach(function (oSchedule) {
					mSchedules[oSchedule.EmployeeID_EmployeeID] = oSchedule;
				});
				aResults[2].forEach(function (oEntry) {
					mBooked[oEntry.Employee_EmployeeID] = (mBooked[oEntry.Employee_EmployeeID] || 0) + HrxTime.minutes(oEntry.Hours);
				});
				aResults[3].forEach(function (oLeave) {
					HrxTime.leaveDays(oLeave, sFrom, sTo).forEach(function (oDay) {
						var mDays = mLeave[oLeave.EmpID_EmployeeID] = mLeave[oLeave.EmpID_EmployeeID] || {};
						mDays[oDay.date] = Math.max(mDays[oDay.date] || 0, oDay.fraction);
					});
				});
				aResults[4].forEach(function (oHoliday) {
					mHolidays[(oHoliday.Site_ID || "*") + "|" + oHoliday.Date] = true;
				});

				var aDays = eachDay(sFrom, sTo);

				return aResults[0].filter(function (oPerson) {
					return oPerson.IsActive;
				}).map(function (oPerson) {
					var oSchedule = mSchedules[oPerson.EmpID];
					var aWorks = DAY_FLAGS.map(function (sFlag, iDay) {
						return oSchedule ? oSchedule[sFlag] === true : iDay >= 1 && iDay <= 5;
					});
					// Every working day owes 8 hours, as on Home and My Timesheet
					var fDayMinutes = HrxTime.WORKING_DAY_MINUTES;
					var mPersonLeave = mLeave[oPerson.EmpID] || {};
					var fExpected = 0;
					var fLeave = 0;

					aDays.forEach(function (oDay) {
						if (!aWorks[oDay.weekday] || mHolidays[oPerson.SiteID + "|" + oDay.iso] || mHolidays["*|" + oDay.iso]) {
							return;
						}
						var fOff = mPersonLeave[oDay.iso] || 0;
						fLeave += fDayMinutes * fOff;
						fExpected += fDayMinutes * (1 - fOff);
					});

					return {
						UserID: oPerson.EmpID,
						FirstName: oPerson.FirstName,
						LastName: oPerson.LastName,
						SiteID: oPerson.SiteID,
						Name: oPerson.Name,
						Email: oPerson.Email,
						UserTypeKey: oPerson.UserType,
						bookedMinutes: mBooked[oPerson.EmpID] || 0,
						expectedMinutes: Math.round(fExpected),
						leaveMinutes: Math.round(fLeave)
					};
				});
			});
		},

		/**
		 * Leave overlapping a range, rejected requests left out.
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @returns {Promise<Array<object>>} Leaves rows
		 */
		leaves: function (sFrom, sTo) {
			return Hrx.list("Leaves", {
				$filter: "StartDate le " + sTo + " and EndDate ge " + sFrom
			}).then(function (aLeaves) {
				return aLeaves.filter(function (oLeave) {
					return !HrxTime.isRejected(oLeave);
				});
			});
		},

		/**
		 * Whether a leave request was turned down. Status_ID is a bare key in the
		 * service; the ids it takes are set in {@link LEAVE_STATUS}.
		 * @param {object} oLeave a Leaves row
		 * @returns {boolean} true when rejected
		 */
		isRejected: function (oLeave) {
			return !!oLeave.Status_ID && oLeave.Status_ID === HrxTime.LEAVE_STATUS.rejected;
		},

		// Leaves.Status_ID: the HRX service records a request's state here (createLeaveRequest
		// sets requested; createLeaveRequestForTeamCalendar approved; actionOnLeave approved
		// or rejected). It never updates WFFlag, so the state must be read from this.
		LEAVE_STATUS: {
			requested: "e7ab05aa-d0d3-11ee-b777-325096b39f47",
			approved: "e7ab02da-d0d3-11ee-b96f-325096b39f47",
			rejected: "e7ab06f4-d0d3-11ee-bc32-325096b39f47"
		},

		/**
		 * The days a leave row covers within a range, with half days as halves.
		 * @param {object} oLeave a Leaves row
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @returns {Array<object>} date and fraction (1, or 0.5 for a half day)
		 */
		leaveDays: function (oLeave, sFrom, sTo) {
			var sStart = oLeave.StartDate > sFrom ? oLeave.StartDate : sFrom;
			var sEnd = oLeave.EndDate < sTo ? oLeave.EndDate : sTo;
			var fFraction = /^(AM|PM|HALF)/i.test(oLeave.DayTime || "") ? 0.5 : 1;
			if (!sStart || !sEnd || sStart > sEnd) {
				return [];
			}
			return eachDay(sStart, sEnd).map(function (oDay) {
				return { date: oDay.iso, fraction: fFraction };
			});
		}
	};

	return HrxTime;
});
