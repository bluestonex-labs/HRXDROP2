/*global QUnit*/

sap.ui.define([
	"bsx/hrx/hrx2026/model/TimesheetReport"
], function (TimesheetReport) {
	"use strict";

	var oPerson = { EmpID: "E1", Name: "Alex Test", Email: "alex@example.com" };
	var oYear = { from: "2026-04-01", to: "2027-03-31" };
	var oOctober = { from: "2026-10-01", to: "2026-10-31" };

	function assignment(sProject, sClient, bBillable, sRate, aEntries) {
		return {
			ProjectID: sProject, ProjectDesc: sProject + " desc", ClientKey: sClient, ClientDesc: sClient + " Ltd",
			ProjectTypeText: bBillable ? "Billable" : "Non-Billable", DayRate: sRate, PONo: "PO1", Currency: "GBP",
			TimeEntries: aEntries || []
		};
	}

	function entry(sRecId, sDate, sHours, sComment) {
		return { RecID: sRecId, Date: sDate, Hours: sHours, Comment: sComment || "" };
	}

	QUnit.module("TimesheetReport - bookings");

	QUnit.test("a project held more than once is counted once", function (assert) {
		var aEntries = [entry("1", "2026-09-07", "08:00:00", "Build"), entry("2", "2026-09-08", "04:00:00", "Test")];
		var aBookings = TimesheetReport.fromAssignments(oPerson, [
			assignment("P1", "C1", false, "0", aEntries),
			assignment("P1", "C1", false, "0", aEntries),
			assignment("P1", "C1", false, "0", aEntries)
		]);

		assert.strictEqual(aBookings.length, 1);
		assert.strictEqual(aBookings[0].entries.length, 2);
		assert.strictEqual(TimesheetReport.daysIn(aBookings[0], oYear), 1.5, "12 hours is a day and a half");
	});

	QUnit.module("TimesheetReport - figures");

	var aBookings = TimesheetReport.fromAssignments(oPerson, [
		assignment("P1", "C1", true, "500", [entry("1", "2026-09-07", "08:00"), entry("2", "2026-10-02", "08:00")]),
		assignment("P2", "C2", false, "850", [entry("3", "2026-09-08", "08:00")]),
		assignment("P3", "C1", true, "0", [entry("4", "2026-03-30", "08:00")])
	]).concat(TimesheetReport.fromAssignments({ EmpID: "E2", Name: "Bea Two", Email: "bea@example.com" }, [
		assignment("P1", "C1", true, "600", [entry("5", "2026-10-05", "04:00")])
	]));

	QUnit.test("billing by assignment prices billable days only", function (assert) {
		var aRows = TimesheetReport.assignments(aBookings, oYear, oOctober);

		assert.strictEqual(aRows.length, 3, "P3 has nothing in the period");
		var oP1 = aRows[0];
		assert.strictEqual(oP1.ProjectKey, "P1");
		assert.strictEqual(oP1.days, 2);
		assert.strictEqual(oP1.total, 1000);
		assert.strictEqual(oP1.month, 500, "one day in October");
		assert.strictEqual(oP1.logs[0].Date, "2026-10-02", "newest first");

		var oP2 = aRows[1];
		assert.strictEqual(oP2.rate, null, "an internal project is not billed, whatever its rate");
		assert.strictEqual(oP2.total, null);
	});

	QUnit.test("overview splits by customer, then by project", function (assert) {
		var oAll = TimesheetReport.overview(aBookings, oYear);
		assert.strictEqual(oAll.total, 3.5);
		assert.strictEqual(oAll.billable, 2.5);
		assert.strictEqual(oAll.nonBillable, 1);
		assert.deepEqual(oAll.slices.map(function (s) { return s.label + "=" + s.value; }), ["C1 Ltd=2.5", "C2 Ltd=1"]);
		assert.strictEqual(oAll.top[0].label, "P1 desc");

		var oDrill = TimesheetReport.overview(aBookings, oYear, "C1");
		assert.deepEqual(oDrill.slices.map(function (s) { return s.key; }), ["P1"]);
	});

	QUnit.test("breakdown totals by customer, project and person", function (assert) {
		var oBreak = TimesheetReport.breakdown(aBookings, oYear);
		assert.deepEqual(oBreak.people.map(function (p) { return p.EmpID; }), ["E1", "E2"]);
		assert.strictEqual(oBreak.customers[0].label, "C1 Ltd");
		assert.strictEqual(oBreak.customers[0].byEmp.E1, 2);
		assert.strictEqual(oBreak.customers[0].byEmp.E2, 0.5);
		assert.strictEqual(oBreak.customers[0].projects[0].total, 2.5);
		assert.strictEqual(oBreak.total, 3.5);
	});

	QUnit.test("utilisation is billable days over days booked", function (assert) {
		var aPeople = TimesheetReport.utilisation(aBookings, oYear);
		var oAlex = aPeople.filter(function (p) { return p.EmpID === "E1"; })[0];
		assert.strictEqual(oAlex.billable, 2);
		assert.strictEqual(oAlex.total, 3);
		assert.strictEqual(oAlex.pct, 67);
		assert.deepEqual(oAlex.projects, ["P1 desc"]);
		assert.strictEqual(TimesheetReport.utilState(80), "Success");
		assert.strictEqual(TimesheetReport.utilState(50), "Warning");
		assert.strictEqual(TimesheetReport.utilState(49), "Error");
	});

	QUnit.test("filters by customer, project and person", function (assert) {
		assert.strictEqual(TimesheetReport.filter(aBookings, { ClientKey: "C1", ProjectKey: "", EmpID: "" }).length, 3);
		assert.strictEqual(TimesheetReport.filter(aBookings, { ClientKey: "", ProjectKey: "P1", EmpID: "E2" }).length, 1);
	});
});
