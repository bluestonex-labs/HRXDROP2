sap.ui.define([], function () {
	"use strict";

	/*
	 * The billing schemes offered when a resource is assigned to a project, as the
	 * live app has them: by office, with the office's default day rate. Picking one
	 * fills in the day rate, which can still be changed.
	 *
	 * The HRX service's BillingScheme table has no office of its own, so the list is
	 * fixed here. An assignment still has to point at a BillingScheme record, so each
	 * option is matched to the service's record by name (see match). If the service
	 * has no record for an option yet, that option cannot be saved until one is added.
	 */

	var OPTIONS = [
		{ key: "CUSTOM", textKey: "mpBillingCustom", dayRate: null, match: /custom/i },
		{ key: "INTERNAL", textKey: "mpBillingInternal", dayRate: 0, match: /internal|non[\s-]?billable/i },
		{ key: "INDIA", textKey: "mpBillingIndia", dayRate: 475, match: /india|aurangabad/i },
		{ key: "UK", textKey: "mpBillingUk", dayRate: 950, match: /\buk\b|united kingdom|oswestry/i }
	];

	var BillingSchemes = {

		OPTIONS: OPTIONS,

		/**
		 * @param {string} sKey an option's key
		 * @returns {object|null} the option
		 */
		option: function (sKey) {
			return OPTIONS.filter(function (oOption) {
				return oOption.key === sKey;
			})[0] || null;
		},

		/**
		 * The service's billing scheme record behind an option.
		 * @param {string} sKey an option's key
		 * @param {Array<object>} aSchemes the service's schemes: BillingID and BillingDesc
		 * @returns {string} that record's BillingID, or "" when the service has none
		 */
		billingId: function (sKey, aSchemes) {
			var oOption = this.option(sKey);
			if (!oOption) {
				return "";
			}
			var oScheme = (aSchemes || []).filter(function (oEntry) {
				return oOption.match.test(oEntry.BillingDesc || "");
			})[0];
			return oScheme ? oScheme.BillingID : "";
		},

		/**
		 * Which option an existing assignment's scheme belongs to.
		 * @param {string} sBillingId the assignment's BillingID
		 * @param {Array<object>} aSchemes the service's schemes
		 * @returns {string} the option's key - Custom when the scheme matches no office
		 */
		keyOf: function (sBillingId, aSchemes) {
			var oScheme = (aSchemes || []).filter(function (oEntry) {
				return oEntry.BillingID === sBillingId;
			})[0];
			if (!oScheme) {
				return sBillingId ? "CUSTOM" : "";
			}
			var oOption = OPTIONS.filter(function (oEntry) {
				return oEntry.match.test(oScheme.BillingDesc || "");
			})[0];
			return oOption ? oOption.key : "CUSTOM";
		}
	};

	return BillingSchemes;
});
