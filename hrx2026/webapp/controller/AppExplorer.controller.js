sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/m/MessageToast"
], function (Controller, MessageToast) {
	"use strict";

	return Controller.extend("bsx.hrx.hrx2026.controller.AppExplorer", {

		/**
		 * Opens the app the tile stands for. The route - and, for a page opened on one
		 * of its tabs (Utilisation), its query - is part of the catalogue, so adding an
		 * app is a data change rather than a code change.
		 * @param {sap.ui.base.Event} oEvent the tile press event
		 */
		onTilePress: function (oEvent) {
			var oContext = oEvent.getSource().getBindingContext("app");
			if (!oContext) {
				return;
			}

			var sRoute = oContext.getProperty("route");
			if (sRoute) {
				var oQuery = oContext.getProperty("query");
				this.getOwnerComponent().getRouter().navTo(sRoute, oQuery ? { "?query": oQuery } : {});
			} else {
				// An app in the design's catalogue that this app has no page for yet
				var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
				MessageToast.show(oBundle.getText("aeNotInApp", [oContext.getProperty("title")]));
			}
		}
	});
});
