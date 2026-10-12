sap.ui.define([], function () {
	"use strict";

	// The attendance policy: three separate sickness absences inside one financial
	// year raise a trigger. It counts instances, not days - a single fortnight off is
	// one instance, three one-day absences are three.
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

	return {

		TRIGGER_INSTANCES: TRIGGER_INSTANCES,

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
		 * @returns {Array<object>} one entry per triggered employee - EmpID, absences (newest
		 * first), instances, days, status ("OPEN"|"DISMISSED"), note (the dismissal reason),
		 * emailed and emailedOn - by name
		 */
		triggers: function (aAbsences, oYear, aReviews) {
			var mByEmp = {};

			(aAbsences || []).forEach(function (oAbsence) {
				if (this.inFiscalYear(oAbsence.StartDate, oYear)) {
					(mByEmp[oAbsence.EmpID] = mByEmp[oAbsence.EmpID] || []).push(oAbsence);
				}
			}, this);

			return Object.keys(mByEmp).filter(function (sEmpId) {
				return mByEmp[sEmpId].length >= TRIGGER_INSTANCES;
			}).map(function (sEmpId) {
				var aList = mByEmp[sEmpId].slice().sort(function (a, b) {
					return b.StartDate.localeCompare(a.StartDate);
				});

				// The latest action of a kind that still covers every instance.
				var fnCurrent = function (sStatus) {
					return (aReviews || []).filter(function (oReview) {
						return oReview.EmpID === sEmpId && oReview.Status === sStatus &&
							(parseInt(oReview.InstanceCount, 10) || 0) >= aList.length;
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
					instances: aList.length,
					days: aList.reduce(function (fTotal, oAbsence) {
						return fTotal + (parseFloat(oAbsence.Days) || 0);
					}, 0),
					status: oDismissal ? "DISMISSED" : "OPEN",
					note: oDismissal ? (oDismissal.Note || "") : "",
					emailed: !!oEmail,
					emailedOn: oEmail ? (oEmail.ReviewedOn || "") : ""
				};
			}).sort(function (a, b) {
				return a.Name.localeCompare(b.Name);
			});
		},

		parseDay: parseDay,
		isoDate: isoDate
	};
});
