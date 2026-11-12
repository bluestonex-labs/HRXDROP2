sap.ui.define([
	"./Hrx",
	"./HrxServices",
	"./SicknessPolicy"
], function (Hrx, HrxServices, SicknessPolicy) {
	"use strict";

	/*
	 * The sickness backend.
	 *
	 * Absences are real: they are leave of the "Sick" type in the HRX service, recorded
	 * by the manager on the employee's behalf (no approval needed), so they also show
	 * on My Leave, the team calendar and in the timesheet's expected hours. One request
	 * - its rows share a LeaveGrpID - is one absence instance.
	 *
	 * What managers do about them is kept by the HRX service too, once it has the
	 * sickness services (see HrxServices): trigger reviews (SicknessReviews,
	 * reviewSicknessTrigger) and return-to-work processes (ReturnsToWork with their
	 * steps). Until then their reads answer with nothing and their writes fail with a
	 * NOT_BOUND error the page reports.
	 */

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

	function isReviewBound() {
		return HrxServices.has("SicknessReviews");
	}

	function notBound() {
		var oError = new Error("The sickness service is not connected yet.");
		oError.notBound = true;
		return Promise.reject(oError);
	}

	// The weekdays from the first day to the last, "yyyy-MM-dd": one leave row each.
	function weekdays(sStart, sEnd) {
		var aDays = [];
		var oDay = SicknessPolicy.parseDay(sStart);
		var oEnd = SicknessPolicy.parseDay(sEnd);
		while (oDay <= oEnd) {
			if (oDay.getDay() !== 0 && oDay.getDay() !== 6) {
				aDays.push(SicknessPolicy.isoDate(oDay));
			}
			oDay.setDate(oDay.getDate() + 1);
		}
		return aDays;
	}

	function commentOf(oAbsence) {
		return (oAbsence.Reason + (oAbsence.Notes ? NOTES_SEPARATOR + oAbsence.Notes : "")).slice(0, COMMENT_LENGTH);
	}

	// An absence's leave rows, the first saved first. AbsenceID is the rows' LeaveGrpID,
	// or the ID of a single row saved without one.
	function absenceRows(sAbsenceId) {
		return Hrx.list("Leaves", {
			$filter: "LeaveGrpID eq " + sAbsenceId + " or ID eq " + sAbsenceId,
			$orderby: "createdAt,StartDate"
		});
	}

	function newGroupId() {
		return window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : undefined;
	}

	function fullName(oEmployee) {
		return oEmployee ? ((oEmployee.FirstName || "") + " " + (oEmployee.LastName || "")).trim() : "";
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
		isReviewBound: isReviewBound,

		/**
		 * Every sickness absence starting in the range, for the whole organisation.
		 * @param {string} sOrgId the organisation
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @returns {Promise<Array<object>>} absences: AbsenceID, EmpID, Name, Email,
		 * StartDate and EndDate ("yyyy-MM-dd"), Days (working days), Reason, Notes,
		 * FitNote ("Y"/"N") and RecordedOn (when it was recorded, a timestamp)
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
					// When the absence was recorded: the first of its rows to be saved.
					var sRecordedOn = aDays.reduce(function (s, o) {
						return o.createdAt && (!s || o.createdAt < s) ? o.createdAt : s;
					}, "");

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
						FitNote: "N",
						RecordedOn: sRecordedOn
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
			var aDays = weekdays(oAbsence.StartDate, oAbsence.EndDate);
			var sComment = commentOf(oAbsence);
			// One absence, however many days: its rows share a group, which is what the
			// policy counts as one instance.
			var sGroup = newGroupId();

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
				// Opens the return-to-work checklist, or carries on the employee's open one.
				if (!isReviewBound()) {
					return vResult;
				}
				return Hrx.callAction("openReturnToWork", {
					EmployeeID: oAbsence.EmpID,
					Steps: (oAbsence.RtwSteps || []).map(function (oStep) {
						return { StepNo: oStep.StepNo, Text: oStep.Text, Done: oStep.Done === "Y" || oStep.Done === true };
					})
				}).then(function () {
					return vResult;
				});
			});
		},

		/**
		 * Corrects a recorded absence: who, the dates, the reason and notes. Its rows are
		 * changed in place - added or removed as the days change - so it stays the same
		 * instance, recorded when it first was. Nothing is emailed, and its return to work
		 * is left as it is.
		 * @param {string} sAbsenceId the absence (AbsenceID from getAbsences)
		 * @param {object} oAbsence EmpID, StartDate, EndDate, Days, Reason and Notes
		 * @returns {Promise} resolved once every row is saved
		 */
		updateAbsence: function (sAbsenceId, oAbsence) {
			var aDays = weekdays(oAbsence.StartDate, oAbsence.EndDate);
			var sComment = commentOf(oAbsence);

			return absenceRows(sAbsenceId).then(function (aRows) {
				if (!aRows.length) {
					throw new Error("That absence no longer exists.");
				}
				var oFirst = aRows[0];
				var sGroup = oFirst.LeaveGrpID || newGroupId();
				var aSaves = aDays.map(function (sDate, iIndex) {
					var oChange = {
						EmpID_EmployeeID: oAbsence.EmpID,
						NoOfDays: String(oAbsence.Days),
						StartDate: sDate,
						EndDate: sDate,
						RequesterComments: sComment,
						LeaveGrpID: sGroup
					};
					if (aRows[iIndex]) {
						return Hrx.update("Leaves(" + aRows[iIndex].ID + ")", oChange);
					}
					// A day the absence did not cover before: a row like its others.
					return Hrx.create("Leaves", Object.assign({
						IsPaid: oFirst.IsPaid,
						LeaveCategoryId_ID: oFirst.LeaveCategoryId_ID,
						DayTime: "Full Day",
						ApprovalRequired: false,
						ApproverID_EmployeeID: oFirst.ApproverID_EmployeeID,
						Status_ID: oFirst.Status_ID,
						WFFlag: null
					}, oChange));
				});
				// Days it no longer covers
				aRows.slice(aDays.length).forEach(function (oRow) {
					aSaves.push(Hrx.remove("Leaves(" + oRow.ID + ")"));
				});
				return Promise.all(aSaves);
			});
		},

		/**
		 * Deletes a recorded absence, every day of it, and the return to work it started
		 * when the page says no other absence carries that on. Nothing is emailed;
		 * trigger reviews are kept.
		 * @param {string} sAbsenceId the absence (AbsenceID from getAbsences)
		 * @param {string} [sRtwId] the return to work to delete with it, steps and all
		 * @returns {Promise} resolved once they are gone
		 */
		deleteAbsence: function (sAbsenceId, sRtwId) {
			return absenceRows(sAbsenceId).then(function (aRows) {
				return Promise.all(aRows.map(function (oRow) {
					return Hrx.remove("Leaves(" + oRow.ID + ")");
				}));
			}).then(function () {
				return sRtwId ? Hrx.remove("ReturnsToWork(" + sRtwId + ")") : null;
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
			if (!isReviewBound()) {
				return Promise.resolve([]);
			}
			return Hrx.list("SicknessReviews", { $filter: "FiscalYear eq " + iFiscalYear, $orderby: "ReviewedOn" }).then(function (aReviews) {
				return aReviews.map(function (oReview) {
					return {
						EmpID: oReview.Employee_EmployeeID,
						Status: oReview.Status,
						Note: oReview.Note || "",
						InstanceCount: oReview.InstanceCount || 0,
						ReviewedBy: oReview.ReviewedBy || "",
						ReviewedOn: oReview.ReviewedOn
					};
				});
			});
		},

		/**
		 * Logs an action on a trigger against the employee's attendance record. Only a
		 * dismissal closes the trigger; an email leaves it open, marked as emailed. The
		 * service records who did it from the sign-in.
		 * @param {object} oReview EmpID, FiscalYear, Status ("EMAILED"|"DISMISSED"),
		 * Note (the dismissal reason, or the email sent) and InstanceCount
		 * @returns {Promise} settles once logged
		 */
		reviewTrigger: function (oReview) {
			if (!isReviewBound()) {
				return notBound();
			}
			return Hrx.callAction("reviewSicknessTrigger", {
				EmployeeID: oReview.EmpID,
				FiscalYear: oReview.FiscalYear,
				Status: oReview.Status,
				Note: oReview.Note || "",
				InstanceCount: oReview.InstanceCount || 0
			});
		},

		/**
		 * Every return-to-work process still in progress.
		 * @returns {Promise<Array<object>>} processes: RtwID, EmpID, Name, Email, Title
		 * (job title), OpenedOn (a timestamp) and Steps - an array of { StepNo, Text,
		 * Done ("Y"/"N") }
		 */
		getReturnsToWork: function () {
			if (!isReviewBound()) {
				return Promise.resolve([]);
			}
			var sEmployeeFields = "EmployeeID,FirstName,LastName,WorkEmail" + (HrxServices.hasProperty("Users", "JobTitle") ? ",JobTitle" : "");
			return Hrx.list("ReturnsToWork", {
				$filter: "Status eq 'OPEN'",
				$expand: "Steps,Employee($select=" + sEmployeeFields + ")"
			}).then(function (aProcesses) {
				return aProcesses.map(function (oProcess) {
					var oEmployee = oProcess.Employee || {};
					return {
						RtwID: oProcess.ID,
						EmpID: oProcess.Employee_EmployeeID,
						Name: fullName(oEmployee),
						Email: String(oEmployee.WorkEmail || "").toLowerCase(),
						Title: oEmployee.JobTitle || "",
						OpenedOn: oProcess.OpenedOn || oProcess.createdAt || "",
						Steps: (oProcess.Steps || []).map(function (oStep) {
							return { StepNo: oStep.StepNo, Text: oStep.Text, Done: oStep.Done ? "Y" : "N" };
						})
					};
				});
			});
		},

		/**
		 * @param {string} sRtwId the process
		 * @param {number} iStepNo the step to mark done
		 * @returns {Promise} settles once saved
		 */
		completeRtwStep: function (sRtwId, iStepNo) {
			if (!isReviewBound()) {
				return notBound();
			}
			return Hrx.callAction("completeReturnToWorkStep", { ReturnToWorkID: sRtwId, StepNo: iStepNo });
		},

		/**
		 * Closes a return-to-work process. The service refuses it while any step is not done.
		 * @param {string} sRtwId the process
		 * @returns {Promise} settles once closed
		 */
		completeRtw: function (sRtwId) {
			if (!isReviewBound()) {
				return notBound();
			}
			return Hrx.callAction("completeReturnToWork", { ReturnToWorkID: sRtwId });
		}
	};
});
