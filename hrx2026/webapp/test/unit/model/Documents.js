/*global QUnit*/

sap.ui.define([
	"bsx/hrx/hrx2026/model/Documents"
], function (Documents) {
	"use strict";

	var aPeople = [
		{ EmpID: "E1", SiteID: "OSW" },
		{ EmpID: "E2", SiteID: "OSW" },
		{ EmpID: "E3", SiteID: "AUR" },
		{ EmpID: "E4", SiteID: "AUR" }
	];

	QUnit.module("Documents");

	QUnit.test("a document is for everyone or for one site", function (assert) {
		assert.strictEqual(Documents.audience({ Visibility: "ALL" }, aPeople).length, 4);
		assert.deepEqual(Documents.audience({ Visibility: "AUR" }, aPeople).map(function (p) {
			return p.EmpID;
		}), ["E3", "E4"]);
	});

	QUnit.test("progress counts only the people a document is for", function (assert) {
		var mAcks = Documents.ackIndex([
			{ DocumentID: "D1", EmpID: "E3" },
			{ DocumentID: "D1", EmpID: "E1" }, // not in the audience - does not count
			{ DocumentID: "D2", EmpID: "E1" }
		]);
		var oProgress = Documents.progress({ DocumentID: "D1", Visibility: "AUR", AckRequired: true }, aPeople, mAcks);

		assert.strictEqual(oProgress.audience.length, 2);
		assert.strictEqual(oProgress.acknowledged.length, 1);
		assert.deepEqual(oProgress.outstanding.map(function (p) {
			return p.EmpID;
		}), ["E4"]);
		assert.strictEqual(oProgress.pct, 50);
	});

	QUnit.test("a document needing no acknowledgement has nobody outstanding", function (assert) {
		var oProgress = Documents.progress({ DocumentID: "D3", Visibility: "ALL", AckRequired: false }, aPeople, {});
		assert.strictEqual(oProgress.outstanding.length, 0);
	});

	QUnit.test("states and filter chips", function (assert) {
		assert.strictEqual(Documents.state(100), "Success");
		assert.strictEqual(Documents.state(80), "Warning");
		assert.strictEqual(Documents.state(79), "Error");
		assert.ok(Documents.matches({ AckRequired: true }, 79, "attention"));
		assert.notOk(Documents.matches({ AckRequired: true }, 80, "attention"));
		assert.ok(Documents.matches({ AckRequired: true }, 100, "complete"));
		assert.ok(Documents.matches({ AckRequired: false }, 0, "none"));
		assert.notOk(Documents.matches({ AckRequired: false }, 0, "attention"));
	});
});
