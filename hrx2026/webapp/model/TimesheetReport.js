sap.ui.define([], function () {
	"use strict";

	/*
	 * The figures behind Timesheet Reporting, worked out from time entries.
	 *
	 * The timesheet service's own billed totals are lifetime figures (and "current
	 * month" always means the calendar month of the call), so every figure here for
	 * a period is summed from the individual entries instead. A booking is one
	 * employee on one project:
	 *   { EmpID, Name, Email, ClientKey, ClientDesc, ProjectKey, ProjectDesc, PONo,
	 *     Billable, DayRate, Currency, entries: [{ RecID, Date, Minutes, Comment }] }
	 * with Date as "yyyy-MM-dd".
	 */

	// A booked day is eight hours - the same day the timesheet service bills by.
	var MINUTES_PER_DAY = 480;

	function sum(aList, fnValue) {
		return aList.reduce(function (fTotal, oItem) {
			return fTotal + fnValue(oItem);
		}, 0);
	}

	function minutesIn(oBooking, oPeriod) {
		return sum(oBooking.entries.filter(function (oEntry) {
			return oEntry.Date >= oPeriod.from && oEntry.Date <= oPeriod.to;
		}), function (oEntry) {
			return oEntry.Minutes;
		});
	}

	function daysIn(oBooking, oPeriod) {
		return minutesIn(oBooking, oPeriod) / MINUTES_PER_DAY;
	}

	function byLabel(a, b) {
		return a.label.localeCompare(b.label);
	}

	return {

		MINUTES_PER_DAY: MINUTES_PER_DAY,

		daysIn: daysIn,

		/**
		 * @param {string} sTime a duration as "hh:mm" or "hh:mm:ss"
		 * @returns {number} the duration in minutes
		 */
		toMinutes: function (sTime) {
			if (!sTime || sTime === "None") {
				return 0;
			}
			var aParts = String(sTime).split(":");
			return (parseInt(aParts[0], 10) || 0) * 60 + (parseInt(aParts[1], 10) || 0);
		},

		/**
		 * One employee's assignments as the timesheet service returns them, folded into
		 * one booking per project. The service can hold the same project more than
		 * once for a person, each copy carrying the same time entries, so entries are
		 * kept once per RecID - otherwise that time would be counted two or three times.
		 * @param {object} oPerson EmpID, Name and Email of the employee
		 * @param {Array<object>} aAssignments the "assignments" of a timesheet fetch
		 * @returns {Array<object>} that person's bookings, in the shape described above
		 */
		fromAssignments: function (oPerson, aAssignments) {
			var mByProject = {};

			(aAssignments || []).forEach(function (oAssignment) {
				var sKey = oAssignment.ProjectID || oAssignment.ProjectKey;
				var oBooking = mByProject[sKey];
				var fRate = parseFloat(oAssignment.DayRate) || 0;

				if (!oBooking) {
					oBooking = mByProject[sKey] = {
						EmpID: oPerson.EmpID,
						Name: oPerson.Name,
						Email: oPerson.Email,
						ClientKey: oAssignment.ClientKey || "",
						ClientDesc: oAssignment.ClientDesc || oAssignment.ClientKey || "",
						ProjectKey: sKey,
						ProjectDesc: oAssignment.ProjectDesc || sKey,
						PONo: oAssignment.PONo && oAssignment.PONo !== "None" ? oAssignment.PONo : "",
						Billable: oAssignment.ProjectTypeText === "Billable",
						DayRate: fRate,
						Currency: oAssignment.Currency || "GBP",
						entries: [],
						_recIds: {}
					};
				} else if (!oBooking.DayRate && fRate) {
					oBooking.DayRate = fRate;
				}

				(oAssignment.TimeEntries || []).forEach(function (oEntry) {
					var sRecId = String(oEntry.RecID || (oEntry.Date + "|" + oEntry.Hours + "|" + oEntry.Comment));
					if (oBooking._recIds[sRecId]) {
						return;
					}
					oBooking._recIds[sRecId] = true;
					oBooking.entries.push({
						RecID: sRecId,
						Date: String(oEntry.Date || "").slice(0, 10),
						Minutes: this.toMinutes(oEntry.Hours),
						Comment: oEntry.Comment && oEntry.Comment !== "None" ? oEntry.Comment : ""
					});
				}, this);
			}, this);

			return Object.keys(mByProject).map(function (sKey) {
				var oBooking = mByProject[sKey];
				delete oBooking._recIds;
				return oBooking;
			});
		},

		/**
		 * @param {Array<object>} aBookings bookings
		 * @param {object} oFilter ClientKey, ProjectKey and EmpID to keep ("" for all)
		 * @returns {Array<object>} the bookings that match
		 */
		filter: function (aBookings, oFilter) {
			return aBookings.filter(function (oBooking) {
				return (!oFilter.ClientKey || oBooking.ClientKey === oFilter.ClientKey) &&
					(!oFilter.ProjectKey || oBooking.ProjectKey === oFilter.ProjectKey) &&
					(!oFilter.EmpID || oBooking.EmpID === oFilter.EmpID);
			});
		},

		/**
		 * Billing by assignment: every employee/project with time booked in the period.
		 * @param {Array<object>} aBookings bookings
		 * @param {object} oPeriod from and to, "yyyy-MM-dd"
		 * @param {object} oMonth the calendar month to report "this month" for
		 * @returns {Array<object>} rows with days, monthDays, rate (billable only), total and
		 * month (billable and priced only, otherwise null) and logs (newest first)
		 */
		assignments: function (aBookings, oPeriod, oMonth) {
			return aBookings.map(function (oBooking) {
				var fDays = daysIn(oBooking, oPeriod);
				var fMonthDays = daysIn(oBooking, oMonth);
				var fRate = oBooking.Billable && oBooking.DayRate ? oBooking.DayRate : null;

				return Object.assign({}, oBooking, {
					key: oBooking.EmpID + "|" + oBooking.ProjectKey,
					days: fDays,
					monthDays: fMonthDays,
					rate: fRate,
					total: fRate ? fDays * fRate : null,
					month: fRate ? fMonthDays * fRate : null,
					logs: oBooking.entries.filter(function (oEntry) {
						return oEntry.Date >= oPeriod.from && oEntry.Date <= oPeriod.to;
					}).sort(function (a, b) {
						return b.Date.localeCompare(a.Date);
					})
				});
			}).filter(function (oRow) {
				return oRow.days > 0;
			}).sort(function (a, b) {
				return a.Name.localeCompare(b.Name) || a.ClientDesc.localeCompare(b.ClientDesc) ||
					a.ProjectDesc.localeCompare(b.ProjectDesc);
			});
		},

		/**
		 * Billed days overview: totals, days by customer (or, drilled into one customer,
		 * by its projects) and the ten projects with the most days.
		 * @param {Array<object>} aBookings bookings
		 * @param {object} oPeriod from and to
		 * @param {string} [sClientKey] the customer drilled into
		 * @returns {object} total, billable, nonBillable, slices [{ key, label, value }]
		 * largest first, and top [{ key, label, value }]
		 */
		overview: function (aBookings, oPeriod, sClientKey) {
			var mSlices = {};
			var mProjects = {};
			var fTotal = 0;
			var fBillable = 0;

			aBookings.forEach(function (oBooking) {
				var fDays = daysIn(oBooking, oPeriod);
				if (!fDays) {
					return;
				}
				fTotal += fDays;
				if (oBooking.Billable) {
					fBillable += fDays;
				}

				var oProject = mProjects[oBooking.ProjectKey] = mProjects[oBooking.ProjectKey] ||
					{ key: oBooking.ProjectKey, label: oBooking.ProjectDesc, value: 0 };
				oProject.value += fDays;

				if (!sClientKey || oBooking.ClientKey === sClientKey) {
					var sKey = sClientKey ? oBooking.ProjectKey : oBooking.ClientKey;
					var oSlice = mSlices[sKey] = mSlices[sKey] ||
						{ key: sKey, label: sClientKey ? oBooking.ProjectDesc : oBooking.ClientDesc, value: 0 };
					oSlice.value += fDays;
				}
			});

			var fnLargest = function (a, b) {
				return (b.value - a.value) || a.label.localeCompare(b.label);
			};

			return {
				total: fTotal,
				billable: fBillable,
				nonBillable: fTotal - fBillable,
				slices: Object.keys(mSlices).map(function (sKey) {
					return mSlices[sKey];
				}).sort(fnLargest),
				top: Object.keys(mProjects).map(function (sKey) {
					return mProjects[sKey];
				}).sort(fnLargest).slice(0, 10)
			};
		},

		/**
		 * Timesheet breakdown: days per customer and project, split by employee.
		 * @param {Array<object>} aBookings bookings
		 * @param {object} oPeriod from and to
		 * @returns {object} people [{ EmpID, label }] who booked time, customers [{ key,
		 * label, byEmp, total, projects: [{ key, label, byEmp, total }] }], byEmp and total
		 */
		breakdown: function (aBookings, oPeriod) {
			var mPeople = {};
			var mCustomers = {};
			var oTotals = { byEmp: {}, total: 0 };

			var fnAdd = function (oTarget, sEmpId, fDays) {
				oTarget.byEmp[sEmpId] = (oTarget.byEmp[sEmpId] || 0) + fDays;
				oTarget.total += fDays;
			};

			aBookings.forEach(function (oBooking) {
				var fDays = daysIn(oBooking, oPeriod);
				if (!fDays) {
					return;
				}
				mPeople[oBooking.EmpID] = { EmpID: oBooking.EmpID, label: oBooking.Name };

				var oCustomer = mCustomers[oBooking.ClientKey] = mCustomers[oBooking.ClientKey] ||
					{ key: oBooking.ClientKey, label: oBooking.ClientDesc, byEmp: {}, total: 0, mProjects: {} };
				var oProject = oCustomer.mProjects[oBooking.ProjectKey] = oCustomer.mProjects[oBooking.ProjectKey] ||
					{ key: oBooking.ProjectKey, label: oBooking.ProjectDesc, byEmp: {}, total: 0 };

				fnAdd(oProject, oBooking.EmpID, fDays);
				fnAdd(oCustomer, oBooking.EmpID, fDays);
				fnAdd(oTotals, oBooking.EmpID, fDays);
			});

			return {
				people: Object.keys(mPeople).map(function (sKey) {
					return mPeople[sKey];
				}).sort(byLabel),
				customers: Object.keys(mCustomers).map(function (sKey) {
					var oCustomer = mCustomers[sKey];
					oCustomer.projects = Object.keys(oCustomer.mProjects).map(function (sProject) {
						return oCustomer.mProjects[sProject];
					}).sort(byLabel);
					delete oCustomer.mProjects;
					return oCustomer;
				}).sort(byLabel),
				byEmp: oTotals.byEmp,
				total: oTotals.total
			};
		},

		/**
		 * Team utilisation: billable days as a share of all days booked, per person.
		 * @param {Array<object>} aBookings bookings
		 * @param {object} oPeriod from and to
		 * @returns {Array<object>} people who booked time - EmpID, Name, Email, billable,
		 * total, pct (whole percent) and projects (billable project names)
		 */
		utilisation: function (aBookings, oPeriod) {
			var mPeople = {};

			aBookings.forEach(function (oBooking) {
				var fDays = daysIn(oBooking, oPeriod);
				if (!fDays) {
					return;
				}
				var oPerson = mPeople[oBooking.EmpID] = mPeople[oBooking.EmpID] ||
					{ EmpID: oBooking.EmpID, Name: oBooking.Name, Email: oBooking.Email, billable: 0, total: 0, projects: [] };

				oPerson.total += fDays;
				if (oBooking.Billable) {
					oPerson.billable += fDays;
					if (oPerson.projects.indexOf(oBooking.ProjectDesc) === -1) {
						oPerson.projects.push(oBooking.ProjectDesc);
					}
				}
			});

			return Object.keys(mPeople).map(function (sKey) {
				var oPerson = mPeople[sKey];
				oPerson.pct = oPerson.total ? Math.round(oPerson.billable / oPerson.total * 100) : 0;
				oPerson.projects.sort();
				return oPerson;
			}).sort(function (a, b) {
				return (b.pct - a.pct) || a.Name.localeCompare(b.Name);
			});
		},

		/**
		 * The prototype's colour bands for utilisation.
		 * @param {number} iPct a utilisation percentage
		 * @returns {string} "Success" (80% and over), "Warning" (50% and over) or "Error"
		 */
		utilState: function (iPct) {
			return iPct >= 80 ? "Success" : iPct >= 50 ? "Warning" : "Error";
		}
	};
});
