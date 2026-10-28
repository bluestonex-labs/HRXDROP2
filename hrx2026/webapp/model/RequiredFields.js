sap.ui.define([], function () {
	"use strict";

	/*
	 * Required fields on the app's forms. A field left empty is marked red when the
	 * form is submitted, and the mark goes as soon as something is put in it - rather
	 * than staying until the next time the form is submitted.
	 */

	// The fields already listening for their mark to go
	var oWatched = new WeakSet();

	function hasValue(oControl) {
		if (oControl.getSelectedKey && oControl.getSelectedKey()) {
			return true;
		}
		if (oControl.getDateValue && oControl.getDateValue()) {
			return true;
		}
		return !!String((oControl.getValue && oControl.getValue()) || "").trim();
	}

	return {

		/**
		 * Marks a field red, or clears its mark.
		 * @param {sap.ui.core.Control} oControl an Input, Select, ComboBox, DatePicker or FileUploader
		 * @param {boolean} bOk true when the field is fine
		 * @param {string} [sText] why it is marked
		 */
		mark: function (oControl, bOk, sText) {
			oControl.setValueState(bOk ? "None" : "Error");
			if (sText) {
				oControl.setValueStateText(sText);
			}
			if (bOk || oWatched.has(oControl)) {
				return;
			}
			oWatched.add(oControl);
			var fnClear = function () {
				if (hasValue(oControl)) {
					oControl.setValueState("None");
				}
			};
			["liveChange", "change", "selectionChange"].forEach(function (sEvent) {
				if (oControl.getMetadata().hasEvent(sEvent)) {
					oControl.attachEvent(sEvent, fnClear);
				}
			});
		},

		/**
		 * Clears every mark on a form, for a dialog opened afresh.
		 * @param {sap.ui.core.Control} oForm the dialog or other container
		 */
		reset: function (oForm) {
			oForm.findAggregatedObjects(true, function (oControl) {
				return oControl.getValueState && oControl.getValueState() === "Error";
			}).forEach(function (oControl) {
				oControl.setValueState("None");
			});
		}
	};
});
