/*global QUnit*/

sap.ui.define([
	"bsx/hrx/hrx2026/model/BillingSchemes"
], function (BillingSchemes) {
	"use strict";

	var aService = [
		{ BillingID: "b-uk", BillingDesc: "UX Consultant UK" },
		{ BillingID: "b-in", BillingDesc: "UX Consultant India" },
		{ BillingID: "b-int", BillingDesc: "Internal Billing" },
		{ BillingID: "b-cus", BillingDesc: "Custom Billing Rate" },
		{ BillingID: "b-snr", BillingDesc: "Senior Consultant" }
	];

	QUnit.module("BillingSchemes");

	QUnit.test("the offices' default day rates", function (assert) {
		assert.strictEqual(BillingSchemes.option("UK").dayRate, 950);
		assert.strictEqual(BillingSchemes.option("INDIA").dayRate, 475);
		assert.strictEqual(BillingSchemes.option("INTERNAL").dayRate, 0);
		assert.strictEqual(BillingSchemes.option("CUSTOM").dayRate, null, "custom leaves the rate to be typed");
	});

	QUnit.test("each option finds its record in the service by name", function (assert) {
		assert.strictEqual(BillingSchemes.billingId("UK", aService), "b-uk");
		assert.strictEqual(BillingSchemes.billingId("INDIA", aService), "b-in");
		assert.strictEqual(BillingSchemes.billingId("INTERNAL", aService), "b-int");
		assert.strictEqual(BillingSchemes.billingId("CUSTOM", aService), "b-cus");
		assert.strictEqual(BillingSchemes.billingId("INTERNAL", [{ BillingID: "nb", BillingDesc: "Non-Billable" }]), "nb");
	});

	QUnit.test("an option the service has no record for cannot be resolved", function (assert) {
		assert.strictEqual(BillingSchemes.billingId("UK", [{ BillingID: "c", BillingDesc: "Consultant" }]), "");
		assert.strictEqual(BillingSchemes.billingId("NOPE", aService), "");
	});

	QUnit.test("an existing assignment opens on its option", function (assert) {
		assert.strictEqual(BillingSchemes.keyOf("b-in", aService), "INDIA");
		assert.strictEqual(BillingSchemes.keyOf("b-snr", aService), "CUSTOM", "a scheme of no office is a custom rate");
		assert.strictEqual(BillingSchemes.keyOf("", aService), "");
	});
});
