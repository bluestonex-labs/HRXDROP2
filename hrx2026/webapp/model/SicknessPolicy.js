sap.ui.define([], function () {
	"use strict";

	// The attendance policy: three separate sickness absences inside one financial
	// year raise a trigger. It counts instances, not days - a single fortnight off is
	// one instance, three one-day absences are three. Absences on consecutive working
	// days are one instance however they were booked, so Friday then Monday is one,
	// and so is Friday then Tuesday when the Monday was a bank holiday or booked off.
	// It goes by half days: any half day worked in between makes a new instance, so off
	// one afternoon, in the next morning and off again that afternoon is two - while
	// off one afternoon and the next morning, with no work between, is still one.
	var TRIGGER_INSTANCES = 3;

	// The financial year runs 1 April to 31 March. Months are zero based.
	var FY_START_MONTH = 3;

	// Indexed by Date.getDay(), so Sunday first. Used when an employee has no work
	// pattern of their own on /Resources.
	var DEFAULT_PATTERN = [false, true, true, true, true, true, false];

	// The return-to-work checklist a manager works through after every recorded
	// absence, in order - the prototype's. The second step starts done when a fit
	// note came in with the absence.
	var RTW_STEPS = [
		"Absence recorded and categorised",
		"Fit note received and filed",
		"Return-to-work conversation held",
		"Wellbeing support options discussed",
		"Outcome recorded and trigger reviewed"
	];

	var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

	function pad(iValue) {
		return String(iValue).padStart(2, "0");
	}

	function isoDate(oDate) {
		return oDate.getFullYear() + "-" + pad(oDate.getMonth() + 1) + "-" + pad(oDate.getDate());
	}

	/**
	 * Reads a "yyyy-MM-dd" day as local midnight. new Date("yyyy-MM-dd") would read it
	 * as UTC midnight, which is the previous day anywhere west of Greenwich.
	 * @param {string} sDay a calendar day
	 * @returns {Date} that day at local midnight
	 */
	function parseDay(sDay) {
		var aParts = String(sDay).split("-");
		return new Date(parseInt(aParts[0], 10), parseInt(aParts[1], 10) - 1, parseInt(aParts[2], 10));
	}

	/**
	 * @param {string} sDay a calendar day, "yyyy-MM-dd"
	 * @param {object} [mDaysOff] the person's other days off (bank holidays, booked leave)
	 * @returns {string} the next day after it the person was due to work, "yyyy-MM-dd"
	 */
	function nextWorkingDay(sDay, mDaysOff) {
		var oDay = parseDay(sDay);
		do {
			oDay.setDate(oDay.getDate() + 1);
		} while (!DEFAULT_PATTERN[oDay.getDay()] || (mDaysOff && mDaysOff[isoDate(oDay)]));
		return isoDate(oDay);
	}

	return {

		TRIGGER_INSTANCES: TRIGGER_INSTANCES,

		/**
		 * How many separate instances of sickness a person's absences make. An absence
		 * that starts no later than the next half day the person was due to work after
		 * the previous one ended carries on the same instance: weekends, bank holidays
		 * and booked leave in between do not break it, a half day worked does.
		 * @param {Array<object>} aAbsences one person's absences, StartDate and EndDate
		 * ("yyyy-MM-dd"), StartHalf ("AM", or "PM" when it began after a morning worked)
		 * and EndHalf ("PM", or "AM" when it ended before an afternoon worked)
		 * @param {object} [mDaysOff] that person's days off, from SicknessService.getDaysOff
		 * @returns {number} the number of instances
		 */
		instancesOf: function (aAbsences, mDaysOff) {
			return this.instanceGroups(aAbsences, mDaysOff).length;
		},

		/**
		 * A person's absences grouped into instances, by the same rule as instancesOf.
		 * @param {Array<object>} aAbsences one person's absences, StartDate and EndDate ("yyyy-MM-dd")
		 * @param {object} [mDaysOff] that person's days off, from SicknessService.getDaysOff
		 * @returns {Array<Array<object>>} each instance's absences, oldest instance first
		 * and oldest absence first within it
		 */
		instanceGroups: function (aAbsences, mDaysOff) {
			// Each absence as half-day slots: "yyyy-MM-dd|AM" or "|PM", which sort in time
			// order. An absence carries on the instance only when it starts no later than
			// the next half day the person was due to work after the previous one ended -
			// any half day worked in between makes it a new instance.
			var fnStart = function (o) {
				return o.StartDate + "|" + (o.StartHalf === "PM" ? "PM" : "AM");
			};
			var fnEnd = function (o) {
				return (o.EndDate || o.StartDate) + "|" + (o.EndHalf === "AM" ? "AM" : "PM");
			};
			var fnNextSlot = function (sSlot) {
				var aSlot = sSlot.split("|");
				return aSlot[1] === "AM" ? aSlot[0] + "|PM" : nextWorkingDay(aSlot[0], mDaysOff) + "|AM";
			};
			var aGroups = [];
			var sRunEnd = "";
			(aAbsences || []).slice().sort(function (a, b) {
				return fnStart(a).localeCompare(fnStart(b));
			}).forEach(function (oAbsence) {
				var sEnd = fnEnd(oAbsence);
				if (sRunEnd && fnStart(oAbsence) <= fnNextSlot(sRunEnd)) {
					aGroups[aGroups.length - 1].push(oAbsence);
					sRunEnd = sEnd > sRunEnd ? sEnd : sRunEnd;
					return;
				}
				aGroups.push([oAbsence]);
				sRunEnd = sEnd;
			});
			return aGroups;
		},

		/**
		 * @param {boolean} bFitNote true when a fit note came in with the absence
		 * @returns {Array<object>} a fresh return-to-work checklist: StepNo, Text and
		 * Done ("Y"/"N") - the absence itself is recorded, so the first step is done
		 */
		rtwSteps: function (bFitNote) {
			return RTW_STEPS.map(function (sText, iIndex) {
				return {
					StepNo: iIndex + 1,
					Text: sText,
					Done: iIndex === 0 || (iIndex === 1 && bFitNote) ? "Y" : "N"
				};
			});
		},

		/**
		 * @param {Date} oDate any day
		 * @returns {object} the financial year that day falls in: startYear, and its
		 * first and last days as Dates and as "yyyy-MM-dd"
		 */
		fiscalYearOf: function (oDate) {
			var iStartYear = oDate.getMonth() >= FY_START_MONTH ? oDate.getFullYear() : oDate.getFullYear() - 1;
			return this.fiscalYear(iStartYear);
		},

		/**
		 * @param {number} iStartYear the calendar year the financial year starts in
		 * @returns {object} that financial year
		 */
		fiscalYear: function (iStartYear) {
			var oStart = new Date(iStartYear, FY_START_MONTH, 1);
			var oEnd = new Date(iStartYear + 1, FY_START_MONTH, 0);

			return {
				startYear: iStartYear,
				start: oStart,
				end: oEnd,
				from: isoDate(oStart),
				to: isoDate(oEnd),
				label: MONTHS[oStart.getMonth()] + " " + oStart.getFullYear() + " – " +
					MONTHS[oEnd.getMonth()] + " " + oEnd.getFullYear()
			};
		},

		/**
		 * An absence belongs to the financial year it starts in, so one that runs over
		 * 31 March is counted once, in the year it began.
		 * @param {string} sStartDay the absence's first day as "yyyy-MM-dd"
		 * @param {object} oYear a financial year from {@link fiscalYear}
		 * @returns {boolean} true when the absence counts towards that year
		 */
		inFiscalYear: function (sStartDay, oYear) {
			return !!sStartDay && sStartDay >= oYear.from && sStartDay <= oYear.to;
		},

		/**
		 * @param {object} [oResource] a /Resources row, carrying Mo..Su as "Y"/"N"
		 * @returns {Array<boolean>} the days that person works, indexed by getDay()
		 */
		workPattern: function (oResource) {
			if (!oResource) {
				return DEFAULT_PATTERN;
			}
			var aPattern = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(function (sDay) {
				return oResource[sDay] === "Y";
			});
			return aPattern.some(Boolean) ? aPattern : DEFAULT_PATTERN;
		},

		/**
		 * @param {Date} oFrom the first day off
		 * @param {Date} oTo the last day off
		 * @param {Array<boolean>} [aPattern] the days the person works, from {@link workPattern}
		 * @returns {number} the working days between the two, both included
		 */
		workingDays: function (oFrom, oTo, aPattern) {
			var aWorks = aPattern || DEFAULT_PATTERN;
			var oDay = new Date(oFrom.getFullYear(), oFrom.getMonth(), oFrom.getDate());
			var iDays = 0;

			while (oDay <= oTo) {
				if (aWorks[oDay.getDay()]) {
					iDays++;
				}
				oDay.setDate(oDay.getDate() + 1);
			}
			return iDays;
		},

		/**
		 * Everyone with enough separate absences in the year to trigger the policy.
		 *
		 * Only a dismissal closes a trigger. Sending a follow-up email is logged too,
		 * but the trigger stays open - it is only marked as emailed.
		 *
		 * Each logged action records how many instances there were when it was taken,
		 * and only counts while that still covers every instance: if another absence
		 * lands afterwards, a dismissed trigger opens again and an emailed one loses
		 * its "email sent" mark, with the whole year's instances counted - a fourth or
		 * fifth instance is exactly when the policy calls for a formal review.
		 * @param {Array<object>} aAbsences absences with EmpID, StartDate ("yyyy-MM-dd") and Days
		 * @param {object} oYear a financial year from {@link fiscalYear}
		 * @param {Array<object>} [aReviews] the actions logged against triggers, any number per
		 * employee: EmpID, Status ("EMAILED"|"DISMISSED"), Note, InstanceCount and ReviewedOn
		 * @param {object} [mDaysOff] by EmpID, each person's days off (SicknessService.getDaysOff)
		 * @returns {Array<object>} one entry per triggered employee - EmpID, absences (newest
		 * first), instances, days, status ("OPEN"|"DISMISSED"), note (the dismissal reason),
		 * emailed and emailedOn - by name
		 */
		triggers: function (aAbsences, oYear, aReviews, mDaysOff) {
			var mByEmp = {};

			(aAbsences || []).forEach(function (oAbsence) {
				if (this.inFiscalYear(oAbsence.StartDate, oYear)) {
					(mByEmp[oAbsence.EmpID] = mByEmp[oAbsence.EmpID] || []).push(oAbsence);
				}
			}, this);

			return Object.keys(mByEmp).filter(function (sEmpId) {
				return this.instancesOf(mByEmp[sEmpId], (mDaysOff || {})[sEmpId]) >= TRIGGER_INSTANCES;
			}, this).map(function (sEmpId) {
				var aList = mByEmp[sEmpId].slice().sort(function (a, b) {
					return b.StartDate.localeCompare(a.StartDate);
				});
				var iInstances = this.instancesOf(aList, (mDaysOff || {})[sEmpId]);

				// The latest action of a kind that still covers every instance.
				var fnCurrent = function (sStatus) {
					return (aReviews || []).filter(function (oReview) {
						return oReview.EmpID === sEmpId && oReview.Status === sStatus &&
							(parseInt(oReview.InstanceCount, 10) || 0) >= iInstances;
					}).sort(function (a, b) {
						return String(b.ReviewedOn || "").localeCompare(String(a.ReviewedOn || ""));
					})[0] || null;
				};
				var oDismissal = fnCurrent("DISMISSED");
				var oEmail = fnCurrent("EMAILED");

				return {
					EmpID: sEmpId,
					Name: aList[0].Name || "",
					absences: aList,
					instances: iInstances,
					days: aList.reduce(function (fTotal, oAbsence) {
						return fTotal + (parseFloat(oAbsence.Days) || 0);
					}, 0),
					status: oDismissal ? "DISMISSED" : "OPEN",
					note: oDismissal ? (oDismissal.Note || "") : "",
					emailed: !!oEmail,
					emailedOn: oEmail ? (oEmail.ReviewedOn || "") : ""
				};
			}, this).sort(function (a, b) {
				return a.Name.localeCompare(b.Name);
			});
		},

		parseDay: parseDay,
		isoDate: isoDate
	};
});
