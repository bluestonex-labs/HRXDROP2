sap.ui.define([
	"./Expenses.controller"
], function (Expenses) {
	"use strict";

	/**
	 * Expenses on a phone, where receipts are photographed: the claims as cards with
	 * "Photograph a receipt" to start a claim from one, and a claim as cards of lines
	 * with the camera button on top. Loading, saving as you type, reading receipts,
	 * the checks and applying for approval are the desktop page's own
	 * (Expenses.controller); only opening a claim from a card is the phone's.
	 */
	return Expenses.extend("bsx.hrx.hrx2026.controller.MobileExpenses", {

		onOpenClaimCard: function (oEvent) {
			this._openClaim(oEvent.getSource().getBindingContext("ex").getProperty("ID"));
		}
	});
});
