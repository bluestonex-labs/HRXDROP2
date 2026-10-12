/*global QUnit*/

sap.ui.define([
	"bsx/hrx/hrx2026/model/Notifications"
], function (Notifications) {
	"use strict";

	// Monday 12 October 2026, 10:00
	var MONDAY = new Date(2026, 9, 12, 10, 0);
	var THURSDAY = new Date(2026, 9, 15, 10, 0);
	var SUNDAY = new Date(2026, 9, 18, 10, 0);

	function status(oLeave) {
		return oLeave.WFFlag === true ? "APR" : oLeave.WFFlag === false ? "REJ" : "REQ";
	}

	QUnit.module("Notifications");

	QUnit.test("a decided request is one notification, with the note when rejected", function (assert) {
		var aItems = Notifications.leaveDecisions([
			{ ID: "a", LeaveGrpID: "G1", StartDate: "2026-11-02", EndDate: "2026-11-02", WFFlag: true, ApprovalRequired: true, modifiedAt: "2026-10-10T09:00:00Z", LeaveCategoryId_ID: "H" },
			{ ID: "b", LeaveGrpID: "G1", StartDate: "2026-11-03", EndDate: "2026-11-03", WFFlag: true, ApprovalRequired: true, modifiedAt: "2026-10-10T09:00:00Z", LeaveCategoryId_ID: "H" },
			{ ID: "c", LeaveGrpID: "G2", StartDate: "2026-12-01", EndDate: "2026-12-01", WFFlag: false, ApprovalRequired: true, ApproverComments: "Busy week", modifiedAt: "2026-10-11T09:00:00Z", LeaveCategoryId_ID: "H" }
		], status, { H: "Holiday" }, MONDAY);

		assert.strictEqual(aItems.length, 2, "two requests");
		assert.strictEqual(aItems[0].kind, "leaveRejected", "newest first");
		assert.strictEqual(aItems[0].note, "Busy week");
		assert.strictEqual(aItems[1].kind, "leaveApproved");
		assert.strictEqual(aItems[1].from, "2026-11-02");
		assert.strictEqual(aItems[1].to, "2026-11-03");
		assert.strictEqual(aItems[1].type, "Holiday");
	});

	QUnit.test("pending, old and no-approval leave are not decisions", function (assert) {
		var aItems = Notifications.leaveDecisions([
			{ ID: "p", StartDate: "2026-11-02", EndDate: "2026-11-02", WFFlag: null, ApprovalRequired: true, modifiedAt: "2026-10-11T09:00:00Z" },
			{ ID: "o", StartDate: "2026-11-02", EndDate: "2026-11-02", WFFlag: true, ApprovalRequired: true, modifiedAt: "2026-09-01T09:00:00Z" },
			{ ID: "n", StartDate: "2026-11-02", EndDate: "2026-11-02", WFFlag: null, ApprovalRequired: false, modifiedAt: "2026-10-11T09:00:00Z" }
		], function (o) {
			return o.ApprovalRequired === false ? "APR" : status(o);
		}, {}, MONDAY);

		assert.strictEqual(aItems.length, 0);
	});

	QUnit.test("the timesheet reminder starts on Thursday and runs over the weekend", function (assert) {
		assert.strictEqual(Notifications.timesheetWindow(MONDAY), null, "not on Monday");
		assert.deepEqual(Notifications.timesheetWindow(THURSDAY), { from: "2026-10-12", to: "2026-10-15" });
		assert.deepEqual(Notifications.timesheetWindow(SUNDAY), { from: "2026-10-12", to: "2026-10-18" });
	});

	QUnit.test("the reminder is only for hours still owed, one per week", function (assert) {
		var oWindow = Notifications.timesheetWindow(THURSDAY);
		var oItem = Notifications.timesheetReminder({ bookedMinutes: 1200, expectedMinutes: 1920 }, oWindow);

		assert.strictEqual(oItem.minutes, 720);
		assert.strictEqual(oItem.id, "timesheet:2026-10-12");
		assert.strictEqual(Notifications.timesheetReminder({ bookedMinutes: 1920, expectedMinutes: 1920 }, oWindow), null);
		assert.strictEqual(Notifications.timesheetReminder(null, oWindow), null);
	});

	QUnit.test("only documents needing acknowledgement and not yet acknowledged", function (assert) {
		var aItems = Notifications.documents([
			{ DocumentID: "D1", Name: "Fire", AckRequired: true, PublishedOn: "2026-10-01" },
			{ DocumentID: "D2", Name: "Away day", AckRequired: false },
			{ DocumentID: "D3", Name: "Handbook", AckRequired: true }
		], { D3: true });

		assert.deepEqual(aItems.map(function (o) {
			return o.id;
		}), ["doc:D1"]);
	});

	QUnit.test("approvals count requests, and a new one changes the id", function (assert) {
		var aPending = [
			{ ID: "1", LeaveGrpID: "G1", createdAt: "2026-10-10T09:00:00Z" },
			{ ID: "2", LeaveGrpID: "G1", createdAt: "2026-10-10T09:00:00Z" },
			{ ID: "3", LeaveGrpID: "G2", createdAt: "2026-10-11T09:00:00Z" }
		];
		var oItem = Notifications.approvals(aPending);

		assert.strictEqual(oItem.count, 2);
		assert.strictEqual(oItem.id, "approvals:G2");
		assert.strictEqual(Notifications.approvals(aPending.concat([{ ID: "4", LeaveGrpID: "G3", createdAt: "2026-10-12T09:00:00Z" }])).id,
			"approvals:G3");
		assert.strictEqual(Notifications.approvals([]), null);
	});

	QUnit.test("read notifications drop out", function (assert) {
		var aItems = [
			{ id: "a", at: new Date(2026, 9, 1) },
			{ id: "b", at: new Date(2026, 9, 3) },
			{ id: "c", at: new Date(2026, 9, 2) }
		];
		assert.deepEqual(Notifications.unread(aItems, ["c"]).map(function (o) {
			return o.id;
		}), ["b", "a"]);
	});
});
