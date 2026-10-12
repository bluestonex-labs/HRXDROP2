sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"../model/CurrentUser",
	"../model/Documents",
	"../model/DocumentService",
	"../model/formatter"
], function (Controller, JSONModel, MessageBox, MessageToast, CurrentUser, Documents, DocumentService, formatter) {
	"use strict";

	/*
	 * Policies to read: the documents an employee has been given, and the ones they
	 * still have to read and acknowledge. Open to everyone.
	 */
	return Controller.extend("bsx.hrx.hrx2026.controller.Policies", {

		formatter: formatter,

		onInit: function () {
			this.setModel(new JSONModel({ busy: false, onlyOutstanding: false, bound: DocumentService.isBound() }), "pdView");
			this.setModel(new JSONModel({ rows: [], kpis: { available: 0, need: 0, outstanding: 0 } }), "pd");

			this.getOwnerComponent().getRouter().getRoute("policies").attachPatternMatched(this._onRouteMatched, this);
		},

		_onRouteMatched: function () {
			CurrentUser.ready(this.getOwnerComponent()).then(function (oProfile) {
				this._oProfile = oProfile;
				this._load();
			}.bind(this));
		},

		onRefresh: function () {
			this._load();
		},

		_load: function () {
			var oViewModel = this.getModel("pdView");
			oViewModel.setProperty("/busy", true);

			return Promise.all([
				DocumentService.getDocuments(this._oProfile.orgId),
				DocumentService.getAcknowledgements(this._oProfile.orgId)
			]).then(function (aResults) {
				this._aDocuments = aResults[0] || [];
				this._mAcks = Documents.ackIndex(aResults[1]);
				this._render();
			}.bind(this)).catch(function (oError) {
				this._aDocuments = [];
				this._mAcks = {};
				this._render();
				this._showError("pdErrorLoad", oError);
			}.bind(this)).then(function () {
				oViewModel.setProperty("/busy", false);
			});
		},

		/**
		 * The documents for the signed-in employee - for everyone, or for their site -
		 * newest first.
		 */
		_render: function () {
			var oMe = { EmpID: this._oProfile.empID, SiteID: this._oProfile.siteID };
			var bOnly = this.getModel("pdView").getProperty("/onlyOutstanding");

			var aMine = (this._aDocuments || []).filter(function (oDocument) {
				return Documents.isFor(oDocument, oMe);
			}).map(function (oDocument) {
				var bDone = !!(this._mAcks[oDocument.DocumentID] || {})[oMe.EmpID];
				var bOutstanding = !!oDocument.AckRequired && !bDone;
				return Object.assign({}, oDocument, {
					outstanding: bOutstanding,
					meta: this.getText("pdMeta", [oDocument.Category || "", oDocument.Version || "1.0",
						formatter.date(oDocument.PublishedOn)]),
					statusText: this.getText(!oDocument.AckRequired ? "pdNoAckNeeded" : bOutstanding ? "pdNotAcknowledged" : "pdAcknowledged"),
					statusState: !oDocument.AckRequired ? "None" : bOutstanding ? "Warning" : "Success"
				});
			}, this).sort(function (a, b) {
				return String(b.PublishedOn || "").localeCompare(String(a.PublishedOn || ""));
			});

			var aOutstanding = aMine.filter(function (oDocument) {
				return oDocument.outstanding;
			});

			this.getModel("pd").setData({
				rows: bOnly ? aOutstanding : aMine,
				kpis: {
					available: aMine.length,
					need: aMine.filter(function (oDocument) {
						return oDocument.AckRequired;
					}).length,
					outstanding: aOutstanding.length
				}
			});
		},

		onFilterChange: function () {
			this._render();
		},

		/**
		 * Opens the document's file in a new tab, streamed from the document service.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onRead: function (oEvent) {
			var oDocument = oEvent.getSource().getBindingContext("pd").getObject();
			var sUrl = DocumentService.fileUrl(oDocument.DocumentID);
			if (!sUrl) {
				MessageBox.information(this.getText("docNotBound"));
				return;
			}
			window.open(sUrl, "_blank", "noopener");
		},

		onAcknowledge: function (oEvent) {
			var oDocument = oEvent.getSource().getBindingContext("pd").getObject();

			DocumentService.acknowledge({
				OrgID: this._oProfile.orgId,
				DocumentID: oDocument.DocumentID,
				EmpID: this._oProfile.empID
			}).then(function () {
				MessageToast.show(this.getText("pdAckToast", [oDocument.Name]));
				this._load();
			}.bind(this)).catch(function (oError) {
				this._showError("pdErrorAcknowledge", oError);
			}.bind(this));
		},

		getModel: function (sName) {
			return this.getView().getModel(sName);
		},

		setModel: function (oModel, sName) {
			this.getView().setModel(oModel, sName);
			return this;
		},

		getText: function (sKey, aArgs) {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(sKey, aArgs);
		},

		_showError: function (sTextKey, oError) {
			if (oError && oError.notBound) {
				MessageBox.information(this.getText("docNotBound"));
				return;
			}
			MessageBox.error(this.getText(sTextKey), { details: (oError && oError.message) || String(oError) });
		}
	});
});
