sap.ui.define([], function () {
	"use strict";

	/*
	 * Who a document is for and how far its acknowledgement has got - shared by the
	 * employee's Policies to read page and the admin Documents page.
	 *
	 * A document is { DocumentID, Visibility ("ALL" or a site ID), AckRequired, ... };
	 * a person is { EmpID, SiteID, ... }; an acknowledgement is { DocumentID, EmpID }.
	 */

	// Below this share acknowledged, a document needs chasing.
	var ATTENTION_PCT = 80;

	var Documents = {

		ATTENTION_PCT: ATTENTION_PCT,

		CATEGORIES: ["Policy", "Procedure", "Handbook", "Form", "Other"],

		/**
		 * @param {object} oDocument a document
		 * @param {object} oPerson a person
		 * @returns {boolean} true when the document is for that person
		 */
		isFor: function (oDocument, oPerson) {
			return !oDocument.Visibility || oDocument.Visibility === "ALL" || oDocument.Visibility === oPerson.SiteID;
		},

		/**
		 * @param {object} oDocument a document
		 * @param {Array<object>} aPeople everyone who could see it
		 * @returns {Array<object>} the people it is for
		 */
		audience: function (oDocument, aPeople) {
			return aPeople.filter(function (oPerson) {
				return Documents.isFor(oDocument, oPerson);
			});
		},

		/**
		 * @param {Array<object>} aAcks acknowledgements
		 * @returns {object} by DocumentID, the EmpIDs that have acknowledged it
		 */
		ackIndex: function (aAcks) {
			var mIndex = {};
			(aAcks || []).forEach(function (oAck) {
				(mIndex[oAck.DocumentID] = mIndex[oAck.DocumentID] || {})[oAck.EmpID] = oAck.AcknowledgedOn || true;
			});
			return mIndex;
		},

		/**
		 * How far a document's acknowledgement has got. Only the people it is for are
		 * counted, so an acknowledgement from someone who has since left, or moved
		 * site, does not inflate it.
		 * @param {object} oDocument a document
		 * @param {Array<object>} aPeople everyone who could see it
		 * @param {object} mAcks from {@link ackIndex}
		 * @returns {object} audience, acknowledged and outstanding (people), and pct
		 */
		progress: function (oDocument, aPeople, mAcks) {
			var aAudience = Documents.audience(oDocument, aPeople);
			var mDone = mAcks[oDocument.DocumentID] || {};
			var aAcknowledged = aAudience.filter(function (oPerson) {
				return !!mDone[oPerson.EmpID];
			});
			var aOutstanding = aAudience.filter(function (oPerson) {
				return !mDone[oPerson.EmpID];
			});
			return {
				audience: aAudience,
				acknowledged: aAcknowledged,
				outstanding: oDocument.AckRequired ? aOutstanding : [],
				pct: aAudience.length ? Math.round(aAcknowledged.length / aAudience.length * 100) : 100
			};
		},

		/**
		 * @param {number} iPct how much of the audience has acknowledged
		 * @returns {string} "Success" (everyone), "Warning" (80% and over) or "Error"
		 */
		state: function (iPct) {
			return iPct >= 100 ? "Success" : iPct >= ATTENTION_PCT ? "Warning" : "Error";
		},

		/**
		 * The admin page's filter chips.
		 * @param {object} oDocument a document
		 * @param {number} iPct its acknowledgement
		 * @param {string} sFilter "all", "attention", "complete" or "none"
		 * @returns {boolean} true when the document belongs under that chip
		 */
		matches: function (oDocument, iPct, sFilter) {
			switch (sFilter) {
				case "attention":
					return !!oDocument.AckRequired && iPct < ATTENTION_PCT;
				case "complete":
					return !!oDocument.AckRequired && iPct >= 100;
				case "none":
					return !oDocument.AckRequired;
				default:
					return true;
			}
		}
	};

	return Documents;
});
