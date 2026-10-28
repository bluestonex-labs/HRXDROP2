sap.ui.define([
	"sap/m/MessageToast"
], function (MessageToast) {
	"use strict";

	/*
	 * Toasts that report a problem are red; the rest stay the theme's own. MessageToast
	 * takes no style class, so the toast is found on the page as soon as it is shown -
	 * it is drawn straight away, and the newest one is last.
	 */
	return {

		/**
		 * @param {string} sText what went wrong, or what is missing
		 */
		error: function (sText) {
			MessageToast.show(sText);
			var aToasts = document.querySelectorAll(".sapMMessageToast");
			if (aToasts.length) {
				aToasts[aToasts.length - 1].classList.add("hrxToastError");
			}
		}
	};
});
