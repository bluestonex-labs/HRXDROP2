sap.ui.define([], function () {
	"use strict";

	/*
	 * The notification bell's rules, kept apart from where the data comes from so
	 * they can be tested on their own (test/unit/model/Notifications.js).
	 *
	 * There is no notification service: every notification is worked out from data
	 * the app already reads. Each carries a stable id, so "read" can be remembered -
	 * and an id changes when the thing it is about changes (a new request waiting,
	 * a new week), which brings it back as unread.
	 *
	 * A notification: { id, kind, subject, detail, at (Date), route }.
	 */

	// Leave decisions are news for this long after they are made.
	var DECISION_DAYS = 14;

	// Thursday: the timesheet reminder only starts then, so it is not nagging on a
	// Monday. getDay() numbers, Sunday 0 - Thursday to Sunday all count.
	var REMIND_FROM_DAY = 4;

	function pad(i) {
		return String(i).padStart(2, "0");
	}

	function iso(oDate) {
		return oDate.getFullYear() + "-" + pad(oDate.getMonth() + 1) + "-" + pad(oDate.getDate());
	}

	function mondayOf(oDate) {
		var iBack = (oDate.getDay() + 6) % 7;
		return new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate() - iBack);
	}

	var Notifications = {

		DECISION_DAYS: DECISION_DAYS,

		/**
		 * @param {Date} oNow now
		 * @returns {Date} the earliest moment a leave decision is still news
		 */
		decisionsSince: function (oNow) {
			return new Date(oNow.getTime() - DECISION_DAYS * 864e5);
		},

		/**
		 * Requests of the employee's that a manager decided recently - one per request
		 * and outcome. Leave that needed no approval (booked by a manager, or a type
		 * that is approved as it is booked) is not a decision and is left out.
		 * @param {Array<object>} aLeaves the employee's Leaves rows
		 * @param {function} fnStatus a row's status: "APR", "REJ" or "REQ"
		 * @param {object} mTypes leave type descriptions by LeaveCategoryId_ID
		 * @param {Date} oNow now
		 * @returns {Array<object>} notifications, newest first
		 */
		leaveDecisions: function (aLeaves, fnStatus, mTypes, oNow) {
			var oSince = this.decisionsSince(oNow);
			var mGroups = {};

			(aLeaves || []).forEach(function (oLeave) {
				var sStatus = fnStatus(oLeave);
				var oAt = new Date(oLeave.modifiedAt);
				if (oLeave.ApprovalRequired === false || (sStatus !== "APR" && sStatus !== "REJ") ||
					isNaN(oAt) || oAt < oSince) {
					return;
				}
				var sKey = (oLeave.LeaveGrpID || oLeave.ID) + ":" + sStatus;
				var oGroup = mGroups[sKey] = mGroups[sKey] || { key: sKey, status: sStatus, rows: [], at: oAt };
				oGroup.rows.push(oLeave);
				if (oAt > oGroup.at) {
					oGroup.at = oAt;
				}
			});

			return Object.keys(mGroups).map(function (sKey) {
				var oGroup = mGroups[sKey];
				var oFirst = oGroup.rows[0];
				var sFrom = oGroup.rows.reduce(function (s, o) {
					return o.StartDate < s ? o.StartDate : s;
				}, oFirst.StartDate);
				var sTo = oGroup.rows.reduce(function (s, o) {
					return o.EndDate > s ? o.EndDate : s;
				}, oFirst.EndDate);
				return {
					id: "leave:" + sKey,
					kind: oGroup.status === "APR" ? "leaveApproved" : "leaveRejected",
					from: sFrom,
					to: sTo,
					type: mTypes[oFirst.LeaveCategoryId_ID] || "",
					note: oGroup.status === "REJ" ? (oFirst.ApproverComments || "") : "",
					at: oGroup.at,
					route: "leave"
				};
			}).sort(function (a, b) {
				return b.at - a.at;
			});
		},

		/**
		 * @param {Date} oNow now
		 * @returns {object|null} the week to check - from (its Monday) and to (today) -
		 * or null before Thursday
		 */
		timesheetWindow: function (oNow) {
			var iDay = oNow.getDay();
			if (iDay !== 0 && iDay < REMIND_FROM_DAY) {
				return null;
			}
			return { from: iso(mondayOf(oNow)), to: iso(oNow) };
		},

		/**
		 * A reminder when the hours due so far this week are not all booked.
		 * @param {object} oRow the employee's compliance row for the week so far:
		 * bookedMinutes and expectedMinutes
		 * @param {object} oWindow from {@link timesheetWindow}
		 * @returns {object|null} the notification, or null when nothing is owed
		 */
		timesheetReminder: function (oRow, oWindow) {
			if (!oRow || !oWindow) {
				return null;
			}
			var iShort = (oRow.expectedMinutes || 0) - (oRow.bookedMinutes || 0);
			if (iShort <= 0) {
				return null;
			}
			var oMonday = new Date(oWindow.from + "T00:00:00");
			return {
				id: "timesheet:" + oWindow.from,
				kind: "timesheet",
				minutes: iShort,
				at: new Date(oMonday.getFullYear(), oMonday.getMonth(), oMonday.getDate() + 3, 8, 0),
				route: "timesheet"
			};
		},

		/**
		 * One notification per document the employee still has to acknowledge.
		 * @param {Array<object>} aDocuments documents for the employee (already
		 * filtered to their audience)
		 * @param {object} mMine DocumentID -> true for those they acknowledged
		 * @returns {Array<object>} notifications
		 */
		documents: function (aDocuments, mMine) {
			return (aDocuments || []).filter(function (oDocument) {
				return oDocument.AckRequired && !mMine[oDocument.DocumentID];
			}).map(function (oDocument) {
				return {
					id: "doc:" + oDocument.DocumentID,
					kind: "document",
					name: oDocument.Name,
					at: new Date(oDocument.PublishedOn || 0),
					route: "policies"
				};
			});
		},

		/**
		 * For a manager: leave requests waiting for them. The id names the newest
		 * request, so another one arriving brings the notification back as unread.
		 * @param {Array<object>} aPending pending Leaves rows
		 * @returns {object|null} the notification, or null when nothing is waiting
		 */
		approvals: function (aPending) {
			var mRequests = {};
			var oNewest = null;

			(aPending || []).forEach(function (oLeave) {
				mRequests[oLeave.LeaveGrpID || oLeave.ID] = true;
				var oAt = new Date(oLeave.createdAt);
				if (!isNaN(oAt) && (!oNewest || oAt > oNewest.at)) {
					oNewest = { at: oAt, key: oLeave.LeaveGrpID || oLeave.ID };
				}
			});

			var iCount = Object.keys(mRequests).length;
			if (!iCount) {
				return null;
			}
			return {
				id: "approvals:" + (oNewest ? oNewest.key : iCount),
				kind: "approvals",
				count: iCount,
				at: oNewest ? oNewest.at : new Date(),
				route: "teamcal"
			};
		},

		/**
		 * @param {Array<object>} aItems notifications
		 * @param {Array<string>} aRead the ids marked as read
		 * @returns {Array<object>} the unread ones, newest first
		 */
		unread: function (aItems, aRead) {
			var mRead = {};
			(aRead || []).forEach(function (sId) {
				mRead[sId] = true;
			});
			return (aItems || []).filter(function (oItem) {
				return oItem && !mRead[oItem.id];
			}).sort(function (a, b) {
				return b.at - a.at;
			});
		},

		mondayOf: mondayOf,
		iso: iso
	};

	return Notifications;
});
