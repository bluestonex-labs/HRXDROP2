sap.ui.define([
	"./Hrx",
	"./HrxServices"
], function (Hrx, HrxServices) {
	"use strict";

	/*
	 * The documents backend: policies and other documents published to the whole
	 * organisation, and who has acknowledged them.
	 *
	 * Served by the HRX service (Policies, PolicyAcknowledgements, acknowledgePolicy,
	 * removePolicy); the file itself is kept in SAP Document Management and opened
	 * through the app's /browser route. Until the HRX service has these (see
	 * HrxServices), reads answer with nothing and writes fail with a NOT_BOUND error
	 * the pages report as "not connected yet".
	 *
	 * The shapes handed to the pages are the ones documented on each method; the
	 * mapping from the HRX entities is in toDocument() and toAcknowledgement().
	 */

	// What the upload dialog accepts - checked in the browser before anything is sent.
	var MAX_FILE_BYTES = 10 * 1024 * 1024;
	var FILE_TYPES = ["pdf", "doc", "docx"];

	// Every document is for the whole organisation.
	var EVERYONE = "ALL";

	// DocumentID -> where its file opens, from the last getDocuments().
	var mFileUrls = {};

	function isBound() {
		return HrxServices.has("Policies");
	}

	function notBound() {
		var oError = new Error("The document service is not connected yet.");
		oError.notBound = true;
		return Promise.reject(oError);
	}

	function toDocument(oPolicy) {
		return {
			DocumentID: oPolicy.ID,
			Name: oPolicy.Name || "",
			Category: oPolicy.Category || "Policy",
			Version: oPolicy.Version || "1.0",
			PublishedOn: oPolicy.PublishedOn || "",
			PublishedBy: oPolicy.PublishedBy || "",
			Visibility: EVERYONE,
			AckRequired: oPolicy.AckRequired !== false,
			FileName: oPolicy.FileName || "",
			MimeType: oPolicy.MimeType || ""
		};
	}

	function toAcknowledgement(oAcknowledgement) {
		return {
			DocumentID: oAcknowledgement.Policy_ID,
			EmpID: oAcknowledgement.Employee_EmployeeID,
			AcknowledgedOn: oAcknowledgement.AcknowledgedOn
		};
	}

	return {

		MAX_FILE_BYTES: MAX_FILE_BYTES,
		FILE_TYPES: FILE_TYPES,

		/**
		 * @returns {boolean} true once the HRX service has the policy services
		 */
		isBound: isBound,

		/**
		 * Every published document - removed ones are left out.
		 * @returns {Promise<Array<object>>} documents: DocumentID, Name, Category
		 * ("Policy" | "Procedure" | "Handbook" | "Form" | "Other"), Version, PublishedOn
		 * ("yyyy-MM-dd"), PublishedBy, Visibility (always "ALL"), AckRequired (true/false),
		 * FileName and MimeType
		 */
		getDocuments: function () {
			if (!isBound()) {
				return Promise.resolve([]);
			}
			return Hrx.list("Policies", { $filter: "IsRemoved eq false or IsRemoved eq null" }).then(function (aPolicies) {
				mFileUrls = {};
				aPolicies.forEach(function (oPolicy) {
					mFileUrls[oPolicy.ID] = Hrx.pictureUrl(oPolicy.FileRootID, oPolicy.FileObjectID);
				});
				return aPolicies.map(toDocument);
			});
		},

		/**
		 * Every acknowledgement of a published document.
		 * @returns {Promise<Array<object>>} acknowledgements: DocumentID, EmpID and
		 * AcknowledgedOn
		 */
		getAcknowledgements: function () {
			if (!isBound()) {
				return Promise.resolve([]);
			}
			return Hrx.list("PolicyAcknowledgements", { $select: "Policy_ID,Employee_EmployeeID,AcknowledgedOn" })
				.then(function (aAcknowledgements) {
					return aAcknowledgements.map(toAcknowledgement);
				});
		},

		/**
		 * Records that the signed-in employee has read and acknowledged a document (the
		 * service takes the employee from the sign-in).
		 * @param {object} oAck DocumentID
		 * @returns {Promise} settles once recorded
		 */
		acknowledge: function (oAck) {
			if (!isBound()) {
				return notBound();
			}
			return Hrx.callAction("acknowledgePolicy", { PolicyID: oAck.DocumentID });
		},

		/**
		 * Publishes a document to the whole organisation: the service records it (and who
		 * published it, and when), then the file is stored in SAP Document Management.
		 * @param {object} oDocument Name, Category, AckRequired and file (a browser File)
		 * @returns {Promise<object>} { data: { DocumentID } }
		 */
		upload: function (oDocument) {
			if (!isBound()) {
				return notBound();
			}
			return Hrx.create("Policies", {
				Name: oDocument.Name,
				Category: oDocument.Category,
				AckRequired: oDocument.AckRequired === true || oDocument.AckRequired === "true"
			}).then(function (oPolicy) {
				return Hrx.upload("Policy", oPolicy.ID, "", oDocument.file, oDocument.file.name).then(function () {
					return { data: { DocumentID: oPolicy.ID } };
				}, function (oError) {
					// Without its file the policy would be published empty: take it back
					// down, then report the upload's own error.
					var fnRethrow = function () {
						throw oError;
					};
					return Hrx.callAction("removePolicy", { PolicyID: oPolicy.ID }).then(fnRethrow, fnRethrow);
				});
			});
		},

		/**
		 * Unpublishes a document: it disappears for employees, and its acknowledgement
		 * history is kept.
		 * @param {object} oRemoval DocumentID
		 * @returns {Promise} settles once removed
		 */
		remove: function (oRemoval) {
			if (!isBound()) {
				return notBound();
			}
			return Hrx.callAction("removePolicy", { PolicyID: oRemoval.DocumentID });
		},

		/**
		 * Where a document's file opens (SAP Document Management, through /browser).
		 * @param {string} sDocumentId the document
		 * @returns {string|null} the url, or null when it has no file
		 */
		fileUrl: function (sDocumentId) {
			return mFileUrls[sDocumentId] || null;
		}
	};
});
