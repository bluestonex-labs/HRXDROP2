sap.ui.define([
	"./Backend",
	"./Hrx",
	"./HrxTime",
	"./HrxLegacy",
	"./SicknessPolicy",
	"./formatter"
], function (Backend, Hrx, HrxTime, HrxLegacy, SicknessPolicy, formatter) {
	"use strict";

	/*
	 * Leave requests for Team Calendar: reading them from the HRX service, gathering
	 * the per-day Leaves rows into requests, and approving, rejecting or cancelling
	 * them. (This used to be the Leave Management admin page, which the 15.10.26
	 * design folds into Team Calendar.)
	 *
	 * A request is the Leaves rows sharing a LeaveGrpID and a status - one row per day
	 * when booked through the app, and a request decided day by day can carry more
	 * than one status.
	 */

	var DAY_FLAGS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

	// Status -> its i18n text and ObjectStatus state.
	var STATUS = {
		REQ: { textKey: "lmPending", state: "Warning" },
		APR: { textKey: "lmApproved", state: "Success" },
		REJ: { textKey: "lmRejected", state: "Error" }
	};

	// Leave type code -> its colour, as the design's colour key has them.
	var TYPE_COLOURS = {
		COMPL: "#D97706",
		HOLIL: "#85B7EB",
		MATEL: "#1FAE72",
		PATEL: "#D52FFF",
		SICKL: "#E5484D",
		UNPDL: "#991B1B",
		BANKHOLIDAY: "#9B9CA1"
	};
	var OTHER_COLOUR = "#9B9CA1";

	var pReferences = null;

	var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

	/**
	 * A date range as the design writes it, whatever the browser's locale:
	 * "3 Oct 2026", "14 – 15 Jul 2026", "29 Aug – 2 Sep 2026".
	 * @param {Date|string} vFrom the first day (a Date or "yyyy-MM-dd")
	 * @param {Date|string} vTo the last day
	 * @returns {string} the label
	 */
	function rangeLabel(vFrom, vTo) {
		var oFrom = formatter.toDate(vFrom);
		var oTo = formatter.toDate(vTo) || oFrom;
		if (!oFrom) {
			return "";
		}
		var fnDay = function (oDate) {
			return oDate.getDate() + " " + MONTHS_SHORT[oDate.getMonth()];
		};
		if (oFrom.toDateString() === oTo.toDateString()) {
			return fnDay(oFrom) + " " + oFrom.getFullYear();
		}
		if (oFrom.getMonth() === oTo.getMonth() && oFrom.getFullYear() === oTo.getFullYear()) {
			return oFrom.getDate() + " – " + fnDay(oTo) + " " + oTo.getFullYear();
		}
		return fnDay(oFrom) + " – " + fnDay(oTo) + " " + oTo.getFullYear();
	}

	/**
	 * @param {string} sCode a leave type code (HOLIL, SICKL, ...)
	 * @returns {string} the colour the calendar and the legend use for it
	 */
	function colourOf(sCode) {
		return TYPE_COLOURS[sCode] || OTHER_COLOUR;
	}

	/**
	 * @param {object} oLeave a Leaves row
	 * @returns {string} "AM", "PM" or "FULL"
	 */
	function slotOf(oLeave) {
		var sSlot = String(oLeave.DayTime || "").trim().toUpperCase();
		return sSlot === "AM" || sSlot === "PM" ? sSlot : "FULL";
	}

	/**
	 * @param {Array<string>} aSlots the slot of each row of a request
	 * @returns {string} the i18n key of the request's duration
	 */
	function durationKey(aSlots) {
		var fnAll = function (sSlot) {
			return aSlots.every(function (s) {
				return s === sSlot;
			});
		};
		if (fnAll("FULL")) {
			return "lmFullDay";
		}
		if (fnAll("AM")) {
			return "lmMorning";
		}
		if (fnAll("PM")) {
			return "lmAfternoon";
		}
		return "lmMixed";
	}

	var TeamLeave = {

		STATUS: STATUS,

		colourOf: colourOf,

		rangeLabel: rangeLabel,

		/**
		 * Everybody, the leave types, everybody's working pattern and the sites, read
		 * once - they change rarely, and every request needs them.
		 * @returns {Promise<object>} { list, people (by EmpID), types (by ID), patterns (by EmpID), sites (by ID) }
		 */
		references: function () {
			if (!pReferences) {
				pReferences = Promise.all([
					HrxTime.people(),
					HrxLegacy.leaveTypes(),
					Hrx.list("WorkSchedule"),
					Hrx.list("Sites", { $select: "ID,SiteDesc" })
				]).then(function (aResults) {
					var oReferences = { list: aResults[0], people: {}, types: {}, patterns: {}, sites: {} };
					aResults[0].forEach(function (oPerson) {
						oReferences.people[oPerson.EmpID] = oPerson;
					});
					aResults[1].forEach(function (oType) {
						oReferences.types[oType.ID] = oType;
					});
					aResults[2].forEach(function (oSchedule) {
						oReferences.patterns[oSchedule.EmployeeID_EmployeeID] = DAY_FLAGS.map(function (sFlag) {
							return oSchedule[sFlag] === true;
						});
					});
					aResults[3].forEach(function (oSite) {
						oReferences.sites[oSite.ID] = oSite.SiteDesc || "";
					});
					return oReferences;
				});
				pReferences.catch(function () {
					pReferences = null;
				});
			}
			return pReferences;
		},

		/**
		 * Every request touching a period, whatever its status.
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @returns {Promise<Array<object>>} Leaves rows
		 */
		leavesBetween: function (sFrom, sTo) {
			return Hrx.list("Leaves", { $filter: "StartDate le " + sTo + " and EndDate ge " + sFrom });
		},

		/**
		 * Every request still waiting for a decision, whatever its dates.
		 * @returns {Promise<Array<object>>} Leaves rows
		 */
		pendingLeaves: function () {
			// Older rows carry no Status_ID; leaveStatus() reads those from their flags.
			return Hrx.list("Leaves", { $filter: "Status_ID eq " + HrxTime.LEAVE_STATUS.requested + " or Status_ID eq null" }).then(function (aLeaves) {
				return aLeaves.filter(function (oLeave) {
					return HrxLegacy.leaveStatus(oLeave) === "REQ";
				});
			});
		},

		/**
		 * Gathers Leaves rows into requests.
		 * @param {Array<object>} aLeaves Leaves rows
		 * @param {object} oReferences what references() gives
		 * @param {function(string, Array=): string} fnText the i18n lookup
		 * @returns {Array<object>} the requests
		 */
		toRequests: function (aLeaves, oReferences, fnText) {
			var mGroups = {};

			aLeaves.forEach(function (oLeave) {
				var sStatus = HrxLegacy.leaveStatus(oLeave);
				var sKey = (oLeave.LeaveGrpID || oLeave.ID) + "|" + sStatus;
				mGroups[sKey] = mGroups[sKey] || { key: sKey, status: sStatus, rows: [] };
				mGroups[sKey].rows.push(oLeave);
			});

			return Object.keys(mGroups).map(function (sKey) {
				var oGroup = mGroups[sKey];
				var aRows = oGroup.rows;
				var oFirst = aRows[0];
				var oPerson = oReferences.people[oFirst.EmpID_EmployeeID] || { Name: oFirst.EmpID_EmployeeID, Email: "" };
				var oType = oReferences.types[oFirst.LeaveCategoryId_ID] || { code: "", desc: "" };
				var aPattern = oReferences.patterns[oFirst.EmpID_EmployeeID];
				var aSlots = aRows.map(slotOf);

				var sFrom = aRows.reduce(function (sEarliest, oRow) {
					return oRow.StartDate < sEarliest ? oRow.StartDate : sEarliest;
				}, oFirst.StartDate);
				var sTo = aRows.reduce(function (sLatest, oRow) {
					return oRow.EndDate > sLatest ? oRow.EndDate : sLatest;
				}, oFirst.EndDate);
				var fDays = aRows.reduce(function (fTotal, oRow, iRow) {
					return fTotal + (aSlots[iRow] !== "FULL" ? 0.5 : SicknessPolicy.workingDays(
						SicknessPolicy.parseDay(oRow.StartDate), SicknessPolicy.parseDay(oRow.EndDate), aPattern));
				}, 0);
				var sDuration = fnText(durationKey(aSlots));
				var oStatus = STATUS[oGroup.status] || STATUS.REQ;

				return {
					key: oGroup.key,
					ids: aRows.map(function (oRow) {
						return oRow.ID;
					}),
					EmpID: oFirst.EmpID_EmployeeID,
					ApproverID: oFirst.ApproverID_EmployeeID || "",
					Name: oPerson.Name,
					FirstName: oPerson.FirstName || String(oPerson.Name || "").split(" ")[0],
					Email: oPerson.Email,
					initials: formatter.nameInitials(oPerson.Name),
					from: sFrom,
					to: sTo,
					dates: rangeLabel(sFrom, sTo),
					days: fDays,
					daysNum: fDays.toFixed(1),
					daysText: fnText(fDays === 1 ? "lmOneDay" : "lmDays", [fDays]),
					typeCode: oType.code,
					type: oType.desc,
					colour: colourOf(oType.code),
					duration: sDuration,
					typeText: oType.desc + " · " + sDuration,
					comments: oFirst.RequesterComments || "",
					approverComments: oFirst.ApproverComments || "",
					status: oGroup.status,
					statusText: fnText(oStatus.textKey),
					statusState: oStatus.state
				};
			});
		},

		/**
		 * Approves or rejects requests, every day of each in one call.
		 * @param {Array<object>} aRequests the requests
		 * @param {string} sStatus "APR" or "REJ"
		 * @param {string} sNote the approver's note to the employee
		 * @param {object} oApprover the signed-in profile: empID, name, email, orgId
		 * @returns {Promise} resolved once saved
		 */
		decide: function (aRequests, sStatus, sNote, oApprover) {
			var sToday = Backend.isoDate(new Date());
			var aDays = [];

			aRequests.forEach(function (oRequest) {
				oRequest.ids.forEach(function (sLeaveId) {
					aDays.push({
						LeaveID: sLeaveId,
						RequesterID: oRequest.EmpID,
						RequesterName: oRequest.Name,
						RequesterEmail: oRequest.Email,
						Status: sStatus,
						OrgID: oApprover.orgId || "",
						ApprovedOn: sToday,
						ApprovedBy: oApprover.empID || "",
						ApproverName: oApprover.name || "",
						ApproverEmail: oApprover.email || "",
						ApproverComments: sNote || ""
					});
				});
			});

			return Backend.postJson(Backend.LEAVE_APPROVALS + "?cmd=action", { LeaveReqSet: aDays });
		},

		/**
		 * Cancels a request that has not started. The service has no cancelled status,
		 * so its rows are removed - as My Leave's delete does.
		 * @param {object} oRequest the request
		 * @returns {Promise} resolved once every day is removed
		 */
		cancel: function (oRequest) {
			return Promise.all(oRequest.ids.map(function (sLeaveId) {
				return Hrx.remove("Leaves(" + sLeaveId + ")");
			}));
		},

		/**
		 * The projects with somebody assigned, and who, for the calendar's project filter.
		 * @returns {Promise<Array<object>>} { ID, name, empIds } sorted by name
		 */
		assignedProjects: function () {
			return Hrx.list("UserToProject", {
				// Assignments saved before IsActive was set hold null: they count as active.
				$filter: "IsActive eq true or IsActive eq null",
				$select: "Employee_EmployeeID,Project_ID",
				$expand: "Project($select=ID,ProjectDesc)"
			}).then(function (aAssignments) {
				var mProjects = {};
				aAssignments.forEach(function (oAssignment) {
					var oProject = oAssignment.Project || {};
					var oEntry = mProjects[oAssignment.Project_ID] = mProjects[oAssignment.Project_ID] ||
						{ ID: oAssignment.Project_ID, name: oProject.ProjectDesc || "", empIds: [] };
					if (oEntry.empIds.indexOf(oAssignment.Employee_EmployeeID) === -1) {
						oEntry.empIds.push(oAssignment.Employee_EmployeeID);
					}
				});
				return Object.keys(mProjects).map(function (sId) {
					return mProjects[sId];
				}).sort(function (a, b) {
					return a.name.localeCompare(b.name);
				});
			});
		},

		/**
		 * The Team leave card's period choices: the next month from today (the default),
		 * each month of the financial year, the whole financial year, or any range.
		 * @param {Date} oToday today
		 * @param {function(string, Array=): string} fnText the i18n lookup
		 * @returns {Array<object>} { key, text, from, to } with from/to as Dates (none for "custom")
		 */
		periods: function (oToday, fnText) {
			var oYear = SicknessPolicy.fiscalYearOf(oToday);
			var oStart = new Date(oToday.getFullYear(), oToday.getMonth(), oToday.getDate());
			var oMonthOn = new Date(oStart.getFullYear(), oStart.getMonth() + 1, oStart.getDate());
			var aPeriods = [{
				key: "next",
				text: fnText("tlPeriodNext", [rangeLabel(oStart, oMonthOn)]),
				from: oStart,
				to: oMonthOn
			}];

			for (var iMonth = 0; iMonth < 12; iMonth++) {
				var oFirst = new Date(oYear.startYear, 3 + iMonth, 1);
				aPeriods.push({
					key: "m" + iMonth,
					text: oFirst.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
					from: oFirst,
					to: new Date(oFirst.getFullYear(), oFirst.getMonth() + 1, 0)
				});
			}

			aPeriods.push({
				key: "fy",
				text: fnText("tlPeriodYear", [oYear.startYear, oYear.startYear + 1]),
				from: new Date(oYear.startYear, 3, 1),
				to: new Date(oYear.startYear + 1, 2, 31)
			});
			aPeriods.push({ key: "custom", text: fnText("tlPeriodCustom") });
			return aPeriods;
		}
	};

	return TeamLeave;
});
