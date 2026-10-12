sap.ui.define([
	"./Backend"
], function (Backend) {
	"use strict";

	/*
	 * The documents backend - the one file to touch when the service is delivered.
	 *
	 * Documents live in SAP Document Management Service (DMS) on BTP; what the pages
	 * also need - each document's category, who it is for, whether it must be
	 * acknowledged, and who has acknowledged it - has to be recorded alongside. This
	 * contract covers both, so whoever builds the service can split them however
	 * suits (files in DMS, the rest in the HRX service, say) behind it.
	 *
	 * It is not built yet, so ENDPOINT is unset: reads answer with nothing (the pages
	 * show their empty states), writes fail with a NOT_BOUND error the pages report as
	 * "not connected yet", and a document has no file to open. Once the service
	 * exists, set ENDPOINT - e.g. Backend.SERVICE_ROOT + "/hrx/documents.xsjs" or a
	 * route to the CAP service - and map its commands or field names below if they
	 * differ, so the pages keep receiving the shapes documented on each method.
	 *
	 * Assumed to follow the other xsjs services: a "cmd" query parameter picks the
	 * operation, and each answer is an envelope of { msgType: "S", data: ... }.
	 */
	var ENDPOINT = null;

	// What the upload dialog accepts - checked in the browser before anything is sent.
	var MAX_FILE_BYTES = 10 * 1024 * 1024;
	var FILE_TYPES = ["pdf", "doc", "docx"];

	function notBound() {
		var oError = new Error("The document service is not connected yet.");
		oError.notBound = true;
		return Promise.reject(oError);
	}

	function get(sCmd, oParams) {
		if (!ENDPOINT) {
			return Promise.resolve([]);
		}
		return Backend.getJson(Backend.query(ENDPOINT, Object.assign({ cmd: sCmd }, oParams)))
			.then(function (oJson) {
				return (oJson && oJson.data) || [];
			});
	}

	function post(sCmd, oPayload) {
		if (!ENDPOINT) {
			return notBound();
		}
		return Backend.postJson(Backend.query(ENDPOINT, { cmd: sCmd }), oPayload);
	}

	return {

		MAX_FILE_BYTES: MAX_FILE_BYTES,
		FILE_TYPES: FILE_TYPES,

		/**
		 * @returns {boolean} true once the service is bound
		 */
		isBound: function () {
			return !!ENDPOINT;
		},

		/**
		 * Every published document - removed ones are left out.
		 * @param {string} sOrgId the organisation
		 * @returns {Promise<Array<object>>} documents: DocumentID, Name, Category
		 * ("Policy" | "Procedure" | "Handbook" | "Form" | "Other"), Version, PublishedOn
		 * ("yyyy-MM-dd"), PublishedBy, Visibility ("ALL" for every employee, otherwise
		 * the site ID it is for), AckRequired (true/false), FileName and MimeType
		 */
		getDocuments: function (sOrgId) {
			return get("documents", { OrgID: sOrgId });
		},

		/**
		 * Every acknowledgement of a published document.
		 * @param {string} sOrgId the organisation
		 * @returns {Promise<Array<object>>} acknowledgements: DocumentID, EmpID and
		 * AcknowledgedOn
		 */
		getAcknowledgements: function (sOrgId) {
			return get("acknowledgements", { OrgID: sOrgId });
		},

		/**
		 * Records that the signed-in employee has read and acknowledged a document.
		 * @param {object} oAck OrgID, DocumentID and EmpID
		 * @returns {Promise<object>} the service's answer
		 */
		acknowledge: function (oAck) {
			return post("acknowledge", oAck);
		},

		/**
		 * Publishes a document: the file goes to DMS, the rest is recorded with it.
		 * Sent as multipart/form-data, the file under "file" and the other fields
		 * alongside it.
		 * @param {object} oDocument OrgID, Name, Category, Visibility, AckRequired,
		 * PublishedBy (the signed-in admin's email) and file (a browser File)
		 * @returns {Promise<object>} the service's answer, with data.DocumentID
		 */
		upload: function (oDocument) {
			if (!ENDPOINT) {
				return notBound();
			}
			var oForm = new FormData();
			Object.keys(oDocument).forEach(function (sKey) {
				if (sKey !== "file") {
					oForm.append(sKey, String(oDocument[sKey]));
				}
			});
			oForm.append("file", oDocument.file, oDocument.file.name);
			return Backend.request(Backend.query(ENDPOINT, { cmd: "upload" }), { method: "POST", body: oForm });
		},

		/**
		 * Unpublishes a document: it disappears for employees, and its acknowledgement
		 * history is kept.
		 * @param {object} oRemoval OrgID, DocumentID and RemovedBy (the signed-in admin's email)
		 * @returns {Promise<object>} the service's answer
		 */
		remove: function (oRemoval) {
			return post("remove", oRemoval);
		},

		/**
		 * Where a document's file can be opened - streamed from DMS by the service.
		 * @param {string} sDocumentId the document
		 * @returns {string|null} the url, or null while the service is not connected
		 */
		fileUrl: function (sDocumentId) {
			return ENDPOINT ? Backend.query(ENDPOINT, { cmd: "file", DocumentID: sDocumentId }) : null;
		}
	};
});
