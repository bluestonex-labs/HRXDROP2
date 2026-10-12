/*global QUnit*/

sap.ui.define([
	"bsx/hrx/hrx2026/model/SicknessPolicy"
], function (SicknessPolicy) {
	"use strict";

	function absence(sEmpId, sStart, fDays) {
		return { EmpID: sEmpId, Name: sEmpId, StartDate: sStart, Days: fDays || 1 };
	}

	QUnit.module("SicknessPolicy - financial year");

	QUnit.test("runs 1 April to 31 March", function (assert) {
		var oYear = SicknessPolicy.fiscalYearOf(new Date(2026, 9, 8));
		assert.strictEqual(oYear.startYear, 2026);
		assert.strictEqual(oYear.from, "2026-04-01");
		assert.strictEqual(oYear.to, "2027-03-31");
		assert.strictEqual(oYear.label, "Apr 2026 – Mar 2027");
	});

	QUnit.test("January to March belong to the year that started the April before", function (assert) {
		assert.strictEqual(SicknessPolicy.fiscalYearOf(new Date(2027, 2, 31)).startYear, 2026);
		assert.strictEqual(SicknessPolicy.fiscalYearOf(new Date(2027, 3, 1)).startYear, 2027);
	});

	QUnit.module("SicknessPolicy - working days");

	QUnit.test("skips weekends by default", function (assert) {
		// Fri 10 Jul to Mon 13 Jul 2026
		assert.strictEqual(SicknessPolicy.workingDays(new Date(2026, 6, 10), new Date(2026, 6, 13)), 2);
		assert.strictEqual(SicknessPolicy.workingDays(new Date(2026, 6, 11), new Date(2026, 6, 12)), 0);
	});

	QUnit.test("follows the employee's own work pattern", function (assert) {
		var aPattern = SicknessPolicy.workPattern({ Mo: "Y", Tu: "Y", We: "Y", Th: "N", Fr: "N", Sa: "N", Su: "N" });
		// Mon 6 Jul to Sun 12 Jul 2026
		assert.strictEqual(SicknessPolicy.workingDays(new Date(2026, 6, 6), new Date(2026, 6, 12), aPattern), 3);
	});

	QUnit.module("SicknessPolicy - return to work");

	QUnit.test("opens the prototype's five step checklist", function (assert) {
		var aSteps = SicknessPolicy.rtwSteps(false);
		assert.strictEqual(aSteps.length, 5);
		assert.strictEqual(aSteps[0].Text, "Absence recorded and categorised");
		assert.strictEqual(aSteps[0].Done, "Y", "the absence is already recorded");
		assert.strictEqual(aSteps[1].Done, "N", "no fit note yet");
		assert.strictEqual(SicknessPolicy.rtwSteps(true)[1].Done, "Y", "fit note received with the absence");
		assert.strictEqual(aSteps[4].StepNo, 5);
	});

	QUnit.module("SicknessPolicy - triggers");

	var oYear = SicknessPolicy.fiscalYear(2026);

	QUnit.test("three instances trigger, however long each was", function (assert) {
		var aTriggers = SicknessPolicy.triggers([
			absence("A", "2026-04-10", 1), absence("A", "2026-06-01", 10), absence("A", "2026-09-01", 0.5),
			absence("B", "2026-05-01", 30), absence("B", "2026-07-01", 30)
		], oYear);

		assert.strictEqual(aTriggers.length, 1);
		assert.strictEqual(aTriggers[0].EmpID, "A");
		assert.strictEqual(aTriggers[0].instances, 3);
		assert.strictEqual(aTriggers[0].days, 11.5);
		assert.strictEqual(aTriggers[0].status, "OPEN");
		assert.strictEqual(aTriggers[0].absences[0].StartDate, "2026-09-01", "newest first");
	});

	QUnit.test("absences in another financial year do not count", function (assert) {
		var aTriggers = SicknessPolicy.triggers([
			absence("A", "2026-03-31"), absence("A", "2026-04-01"), absence("A", "2027-03-31"), absence("A", "2027-04-01")
		], oYear);

		assert.strictEqual(aTriggers.length, 0);
	});

	QUnit.test("a dismissal closes the trigger until another absence arrives", function (assert) {
		var aAbsences = [absence("A", "2026-04-10"), absence("A", "2026-06-01"), absence("A", "2026-09-01")];
		var aReviews = [{ EmpID: "A", Status: "DISMISSED", Note: "Spoke to them", InstanceCount: 3 }];

		var oReviewed = SicknessPolicy.triggers(aAbsences, oYear, aReviews)[0];
		assert.strictEqual(oReviewed.status, "DISMISSED");
		assert.strictEqual(oReviewed.note, "Spoke to them");

		aAbsences.push(absence("A", "2026-10-01"));
		assert.strictEqual(SicknessPolicy.triggers(aAbsences, oYear, aReviews)[0].status, "OPEN");
	});

	QUnit.test("an email marks the trigger but leaves it open", function (assert) {
		var aAbsences = [absence("A", "2026-04-10"), absence("A", "2026-06-01"), absence("A", "2026-09-01")];
		var aReviews = [{ EmpID: "A", Status: "EMAILED", InstanceCount: 3, ReviewedOn: "2026-09-10" }];

		var oTrigger = SicknessPolicy.triggers(aAbsences, oYear, aReviews)[0];
		assert.strictEqual(oTrigger.status, "OPEN", "still open after the email");
		assert.strictEqual(oTrigger.emailed, true);
		assert.strictEqual(oTrigger.emailedOn, "2026-09-10");

		aReviews.push({ EmpID: "A", Status: "DISMISSED", Note: "Spoke to them", InstanceCount: 3, ReviewedOn: "2026-09-12" });
		assert.strictEqual(SicknessPolicy.triggers(aAbsences, oYear, aReviews)[0].status, "DISMISSED", "closed by the dismissal");
	});

	QUnit.test("a fourth absence keeps the whole year's count rather than starting again", function (assert) {
		var aAbsences = [absence("A", "2026-04-10", 1), absence("A", "2026-06-01", 2), absence("A", "2026-09-01", 1),
			absence("A", "2027-01-12", 3)];
		var aReviews = [
			{ EmpID: "A", Status: "EMAILED", InstanceCount: 3, ReviewedOn: "2026-09-10" },
			{ EmpID: "A", Status: "DISMISSED", InstanceCount: 3, ReviewedOn: "2026-09-12" }
		];

		var oTrigger = SicknessPolicy.triggers(aAbsences, oYear, aReviews)[0];
		assert.strictEqual(oTrigger.status, "OPEN", "reopened by the fourth instance");
		assert.strictEqual(oTrigger.emailed, false, "the earlier email covered only three");
		assert.strictEqual(oTrigger.instances, 4, "all four instances counted");
		assert.strictEqual(oTrigger.absences.length, 4, "all four in the history");
		assert.strictEqual(oTrigger.days, 7);

		aReviews.push({ EmpID: "A", Status: "DISMISSED", InstanceCount: 4, ReviewedOn: "2027-01-20" });
		assert.strictEqual(SicknessPolicy.triggers(aAbsences, oYear, aReviews)[0].status, "DISMISSED",
			"closed once the fourth is dismissed");
	});
});
