sap.ui.define([
	"./Backend",
	"./Hrx",
	"./SicknessPolicy"
], function (Backend, Hrx, SicknessPolicy) {
	"use strict";

	/*
	 * The sickness backend.
	 *
	 * Absences are real: they are leave of the "Sick" type in the HRX service, recorded
	 * by the manager on the employee's behalf (no approval needed), so they also show
	 * on My Leave, the team calendar and in the timesheet's expected hours. One request
	 * - its rows share a LeaveGrpID - is one absence instance.
	 *
	 * The HRX service has nowhere to keep the rest - trigger reviews (follow-up emails,
	 * dismissals) and return-to-work checklists - so those still go to ENDPOINT, a
	 * service still to be built. Unset, their reads answer with nothing and their
	 * writes fail with a NOT_BOUND error the page reports. Once that service exists,
	 * set ENDPOINT - e.g. Backend.SERVICE_ROOT + "/hrx/sickness.xsjs" - and map its
	 * commands below if they differ.
	 */
	var ENDPOINT = null;

	// RequesterComments holds the reason and any notes; it is 255 characters long.
	var COMMENT_LENGTH = 255;
	var NOTES_SEPARATOR = " — ";

	function sickTypeId() {
		return Hrx.list("LeaveType").then(function (aTypes) {
			var oSick = aTypes.filter(function (oType) {
				return /sick/i.test(oType.LeaveCategoryDesc || "");
			})[0];
			if (!oSick) {
				throw new Error("The HRX service has no sick leave type.");
			}
			return oSick.ID;
		});
	}

	function signedInEmpId() {
		var CurrentUser = sap.ui.require("bsx/hrx/hrx2026/model/CurrentUser");
		var oProfile = CurrentUser && CurrentUser.get();
		return (oProfile && oProfile.empID) || null;
	}

	function notBound() {
		var oError = new Error("The sickness service is not connected yet.");
		oError.notBound = true;
		return Promise.reject(oError);
	}

	function get(sCmd, oParams) {
		if (!ENDPOINT) {
			return Promise.resolve([]);
		}
		return Backend.getJson(Backend.query(ENDPOINT, Object.assign({ cmd: sCmd }, oParams)))
			.then(function (oJson) {
				return (oJson && oJson.data) || [];
			});
	}

	function post(sCmd, oPayload) {
		if (!ENDPOINT) {
			return notBound();
		}
		return Backend.postJson(Backend.query(ENDPOINT, { cmd: sCmd }), oPayload);
	}

	return {

		/**
		 * @returns {boolean} true: absences are read from the HRX service
		 */
		isBound: function () {
			return true;
		},

		/**
		 * @returns {boolean} true once trigger reviews and return to work can be saved
		 */
		isReviewBound: function () {
			return !!ENDPOINT;
		},

		/**
		 * Every sickness absence starting in the range, for the whole organisation.
		 * @param {string} sOrgId the organisation
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @returns {Promise<Array<object>>} absences: AbsenceID, EmpID, Name, Email,
		 * StartDate and EndDate ("yyyy-MM-dd"), Days (working days), Reason, Notes and
		 * FitNote ("Y"/"N")
		 */
		getAbsences: function (sOrgId, sFrom, sTo) {
			return sickTypeId().then(function (sSickId) {
				return Hrx.list("Leaves", {
					$filter: "LeaveCategoryId_ID eq " + sSickId + " and StartDate le " + sTo + " and EndDate ge " + sFrom,
					$expand: "EmpID($select=EmployeeID,FirstName,LastName,WorkEmail)"
				});
			}).then(function (aRows) {
				var mGroups = {};
				aRows.forEach(function (oRow) {
					var sKey = oRow.LeaveGrpID || oRow.ID;
					(mGroups[sKey] = mGroups[sKey] || []).push(oRow);
				});

				return Object.keys(mGroups).map(function (sKey) {
					var aDays = mGroups[sKey];
					var oFirst = aDays[0];
					var oEmployee = oFirst.EmpID || {};
					var sStart = aDays.reduce(function (s, o) {
						return o.StartDate < s ? o.StartDate : s;
					}, oFirst.StartDate);
					var sEnd = aDays.reduce(function (s, o) {
						return o.EndDate > s ? o.EndDate : s;
					}, oFirst.EndDate);
					var fDays = aDays.reduce(function (fTotal, o) {
						return fTotal + (/^(AM|PM)$/i.test(o.DayTime || "") ? 0.5 :
							SicknessPolicy.workingDays(SicknessPolicy.parseDay(o.StartDate), SicknessPolicy.parseDay(o.EndDate)));
					}, 0);
					var aComment = String(oFirst.RequesterComments || "").split(NOTES_SEPARATOR);

					return {
						AbsenceID: sKey,
						EmpID: oFirst.EmpID_EmployeeID,
						Name: ((oEmployee.FirstName || "") + " " + (oEmployee.LastName || "")).trim(),
						Email: String(oEmployee.WorkEmail || "").toLowerCase(),
						StartDate: sStart,
						EndDate: sEnd,
						Days: fDays,
						Reason: aComment[0] || "",
						Notes: aComment.slice(1).join(NOTES_SEPARATOR),
						FitNote: "N"
					};
				});
			});
		},

		/**
		 * Records an absence, and opens the return-to-work process the manager then
		 * works through on the page. The service should create that process from
		 * RtwSteps - the checklist is the page's to define, so every card matches -
		 * unless the employee already has one in progress, which carries on instead.
		 * @param {object} oAbsence OrgID, EmpID, StartDate, EndDate, Days, Reason, Notes,
		 * FitNote ("Y"/"N"), RecordedBy (the signed-in admin's email) and RtwSteps (the
		 * checklist to open: { StepNo, Text, Done ("Y"/"N") } each)
		 * @returns {Promise<object>} the service's answer
		 */
		recordAbsence: function (oAbsence) {
			var aDays = [];
			var oDay = SicknessPolicy.parseDay(oAbsence.StartDate);
			var oEnd = SicknessPolicy.parseDay(oAbsence.EndDate);
			while (oDay <= oEnd) {
				if (oDay.getDay() !== 0 && oDay.getDay() !== 6) {
					aDays.push(SicknessPolicy.isoDate(oDay));
				}
				oDay.setDate(oDay.getDate() + 1);
			}
			var sComment = (oAbsence.Reason + (oAbsence.Notes ? NOTES_SEPARATOR + oAbsence.Notes : "")).slice(0, COMMENT_LENGTH);
			// One absence, however many days: its rows share a group, which is what the
			// policy counts as one instance.
			var sGroup = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : undefined;

			return sickTypeId().then(function (sSickId) {
				return Hrx.callAction("createLeaveRequestForTeamCalendar", {
					userLog: aDays.map(function (sDate) {
						return {
							EmpID_EmployeeID: oAbsence.EmpID,
							IsPaid: true,
							LeaveCategoryId_ID: sSickId,
							NoOfDays: String(oAbsence.Days),
							StartDate: sDate,
							EndDate: sDate,
							DayTime: "Full Day",
							ApprovalRequired: false,
							ApproverID_EmployeeID: signedInEmpId(),
							RequesterComments: sComment,
							LeaveGrpID: sGroup,
							WFFlag: null
						};
					})
				});
			}).then(function (vResult) {
				// The return-to-work checklist has nowhere to go yet; the absence itself is saved.
				if (ENDPOINT) {
					return post("openRtw", { EmpID: oAbsence.EmpID, RtwSteps: oAbsence.RtwSteps }).then(function () {
						return vResult;
					});
				}
				return vResult;
			});
		},

		/**
		 * Every action logged against policy triggers in a financial year - a log, so
		 * one employee can have several (an email, then a dismissal, ...).
		 * @param {string} sOrgId the organisation
		 * @param {number} iFiscalYear the calendar year the financial year starts in
		 * @returns {Promise<Array<object>>} actions: EmpID, Status ("EMAILED"|"DISMISSED"),
		 * Note, InstanceCount (absences at the time of the action), ReviewedBy and
		 * ReviewedOn (when it was logged - a timestamp, or "yyyy-MM-dd")
		 */
		getTriggerReviews: function (sOrgId, iFiscalYear) {
			return get("triggerReviews", { OrgID: sOrgId, FiscalYear: iFiscalYear });
		},

		/**
		 * Logs an action on a trigger against the employee's attendance record. Only a
		 * dismissal closes the trigger; an email leaves it open, marked as emailed.
		 * @param {object} oReview OrgID, EmpID, FiscalYear, Status ("EMAILED"|"DISMISSED"),
		 * Note (the dismissal reason, or the email sent), InstanceCount and ReviewedBy
		 * @returns {Promise<object>} the service's answer
		 */
		reviewTrigger: function (oReview) {
			return post("reviewTrigger", oReview);
		},

		/**
		 * Every return-to-work process still in progress.
		 * @param {string} sOrgId the organisation
		 * @returns {Promise<Array<object>>} processes: RtwID, EmpID, Name, Email, Title
		 * (job title) and Steps - an array of { StepNo, Text, Done ("Y"/"N") }
		 */
		getReturnsToWork: function (sOrgId) {
			return get("returnsToWork", { OrgID: sOrgId });
		},

		/**
		 * @param {string} sRtwId the process
		 * @param {number} iStepNo the step to mark done
		 * @param {string} sBy the signed-in admin's email
		 * @returns {Promise<object>} the service's answer
		 */
		completeRtwStep: function (sRtwId, iStepNo, sBy) {
			return post("completeRtwStep", { RtwID: sRtwId, StepNo: iStepNo, CompletedBy: sBy });
		},

		/**
		 * Closes a return-to-work process. The page only offers this once every step is
		 * done; the service should refuse it otherwise.
		 * @param {string} sRtwId the process
		 * @param {string} sBy the signed-in admin's email
		 * @returns {Promise<object>} the service's answer
		 */
		completeRtw: function (sRtwId, sBy) {
			return post("completeRtw", { RtwID: sRtwId, CompletedBy: sBy });
		}
	};
});
