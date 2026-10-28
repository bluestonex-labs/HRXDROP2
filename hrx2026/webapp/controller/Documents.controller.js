sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Fragment",
	"sap/ui/core/format/DateFormat",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"../model/Backend",
	"../model/CurrentUser",
	"../model/Documents",
	"../model/DocumentService",
	"../model/Mail",
	"../model/Reminders",
	"../model/formatter",
	"../model/RequiredFields",
	"../model/Toast"
], function (Controller, Fragment, DateFormat, JSONModel, Filter, FilterOperator, MessageBox, MessageToast, Backend, CurrentUser, Documents, DocumentService, Mail, Reminders, formatter, RequiredFields, Toast) {
	"use strict";

	var FILTERS = ["all", "attention", "complete", "none"];

	// The icon after a document's acknowledgement bar, by the bar's state
	var ACK_ICONS = { Success: "ok", Warning: "warn", Error: "crit" };

	// The design's dates on a document: "8 Jul 2026"
	var oPublishedDate = DateFormat.getDateInstance({ pattern: "d MMM yyyy" });
	var oServiceDate = DateFormat.getDateInstance({ pattern: "yyyy-MM-dd" });

	/**
	 * @param {string} sDate a service date, "yyyy-MM-dd"
	 * @returns {string} the date as the design shows it, or "" when there is none
	 */
	function publishedText(sDate) {
		var oDate = sDate ? oServiceDate.parse(String(sDate).slice(0, 10)) : null;
		return oDate ? oPublishedDate.format(oDate) : "";
	}

	/*
	 * Documents (admin): publish policies and other documents, see who has and has
	 * not acknowledged each one, remind those outstanding, and unpublish.
	 */
	return Controller.extend("bsx.hrx.hrx2026.controller.Documents", {

		formatter: formatter,

		onInit: function () {
			this.setModel(new JSONModel({
				busy: false,
				bound: DocumentService.isBound(),
				q: "",
				category: "",
				filter: "all",
				selected: ""
			}), "dmView");
			this.setModel(new JSONModel({ rows: [], chips: [], categories: [], outstanding: [], selected: {}, total: 0 }), "dm");

			// A click anywhere on a document's row selects it; its remind button is the
			// one part of the row with an action of its own.
			this.byId("documentsList").addEventDelegate({
				onclick: function (oEvent) {
					if (oEvent.target.closest(".sapMBtn")) {
						return;
					}
					var oRow = oEvent.target.closest(".hrxDmRow");
					if (oRow) {
						this.getModel("dmView").setProperty("/selected", oRow.getAttribute("data-id"));
						this._render();
					}
				}
			}, this);

			this.getOwnerComponent().getRouter().getRoute("documents").attachPatternMatched(this._onRouteMatched, this);
		},

		_onRouteMatched: function () {
			CurrentUser.ready(this.getOwnerComponent()).then(function (oProfile) {
				this._oProfile = oProfile;
				if (oProfile.isManager) {
					this._load();
				}
			}.bind(this));
		},

		onRefresh: function () {
			if (this._oProfile && this._oProfile.isManager) {
				this._load();
			}
		},

		/* =========================================================== */
		/* data                                                        */
		/* =========================================================== */

		_load: function () {
			var oViewModel = this.getModel("dmView");
			var oModel = this.getOwnerComponent().getModel();
			var sOrgId = this._oProfile.orgId;

			oViewModel.setProperty("/busy", true);

			return Promise.all([
				DocumentService.getDocuments(sOrgId),
				DocumentService.getAcknowledgements(sOrgId),
				Backend.read(oModel, "/Resources", {
					urlParameters: { "$select": "EmpID,FName,LName,Email,BaseSiteKey,IsActive" },
					filters: [new Filter("OrgID", FilterOperator.EQ, sOrgId)]
				}),
				Backend.read(oModel, "/sites", { filters: [new Filter("OrgID", FilterOperator.EQ, sOrgId)] })
			]).then(function (aResults) {
				var mSites = {};
				((aResults[3] && aResults[3].results) || []).forEach(function (oSite) {
					mSites[oSite.SiteID] = oSite.SiteDesc || oSite.SiteID;
				});
				this._mSites = mSites;
				this._aDocuments = aResults[0] || [];
				this._mAcks = Documents.ackIndex(aResults[1]);
				this._aPeople = ((aResults[2] && aResults[2].results) || []).filter(function (oResource) {
					return oResource.IsActive === "Y";
				}).map(function (oResource) {
					var sName = ((oResource.FName || "") + " " + (oResource.LName || "")).trim() || oResource.Email;
					return {
						EmpID: oResource.EmpID,
						Name: sName,
						Email: oResource.Email || "",
						SiteID: oResource.BaseSiteKey || "",
						siteName: mSites[oResource.BaseSiteKey] || "",
						initials: formatter.nameInitials(sName)
					};
				}).sort(function (a, b) {
					return a.Name.localeCompare(b.Name);
				});
				this._render();
			}.bind(this)).catch(function (oError) {
				this._aDocuments = [];
				this._aPeople = this._aPeople || [];
				this._mAcks = {};
				this._render();
				this._showError("dmErrorLoad", oError);
			}.bind(this)).then(function () {
				oViewModel.setProperty("/busy", false);
			});
		},

		/**
		 * The document list (lowest acknowledgement first, so the ones that need chasing
		 * are at the top), its filter chips, and who has not acknowledged the selected one.
		 */
		_render: function () {
			var oViewModel = this.getModel("dmView");
			var sQuery = (oViewModel.getProperty("/q") || "").toLowerCase();
			var sCategory = oViewModel.getProperty("/category");
			var sFilter = oViewModel.getProperty("/filter");
			var sSelected = oViewModel.getProperty("/selected");
			var aPeople = this._aPeople || [];

			var aAll = (this._aDocuments || []).map(function (oDocument) {
				var oProgress = Documents.progress(oDocument, aPeople, this._mAcks || {});
				var sAckState = Documents.state(oProgress.pct);
				return Object.assign({}, oDocument, {
					progress: oProgress,
					pct: oProgress.pct,
					outstandingCount: oProgress.outstanding.length,
					meta: this.getText("dmMeta", [oDocument.Category || "", this._visibilityText(oDocument.Visibility),
						publishedText(oDocument.PublishedOn)]),
					ackText: oDocument.AckRequired ?
						this.getText("dmAckCount", [oProgress.acknowledged.length, oProgress.audience.length]) :
						this.getText("pdNoAckNeeded"),
					// the bar's colour (ProgressIndicator state) and the icon after it
					ackState: sAckState,
					ackIcon: ACK_ICONS[sAckState]
				});
			}, this);

			var aRows = aAll.filter(function (oDocument) {
				return Documents.matches(oDocument, oDocument.pct, sFilter) &&
					(!sCategory || oDocument.Category === sCategory) &&
					(!sQuery || String(oDocument.Name || "").toLowerCase().indexOf(sQuery) !== -1);
			}).sort(function (a, b) {
				return (a.AckRequired === b.AckRequired ? 0 : a.AckRequired ? -1 : 1) ||
					(a.AckRequired ? a.pct - b.pct : 0) ||
					String(b.PublishedOn || "").localeCompare(String(a.PublishedOn || ""));
			}).map(function (oDocument) {
				return Object.assign(oDocument, { selected: oDocument.DocumentID === sSelected });
			});

			var iLow = aAll.filter(function (oDocument) {
				return Documents.matches(oDocument, oDocument.pct, "attention");
			}).length;

			var aCategories = [];
			aAll.forEach(function (oDocument) {
				if (oDocument.Category && aCategories.indexOf(oDocument.Category) === -1) {
					aCategories.push(oDocument.Category);
				}
			});

			var oSelected = aAll.filter(function (oDocument) {
				return oDocument.DocumentID === sSelected;
			})[0];
			var sEmptyTitle = "";
			var sEmptyText = "";
			if (!oSelected) {
				sEmptyTitle = this.getText("dmSelectTitle");
				sEmptyText = this.getText("dmSelectText");
			} else if (!oSelected.AckRequired) {
				sEmptyTitle = this.getText("pdNoAckNeeded");
				sEmptyText = this.getText("dmNoAckText");
			} else if (!oSelected.outstandingCount) {
				sEmptyTitle = this.getText("dmEveryone");
			}

			this.getModel("dm").setData({
				total: aAll.length,
				rows: aRows,
				low: iLow,
				lowText: this.getText(iLow === 1 ? "dmLowOne" : "dmLowMany", [iLow]),
				countText: aRows.length === aAll.length ? this.getText("dmPublished", [aAll.length]) :
					this.getText("dmShowing", [aRows.length, aAll.length]),
				categories: [{ key: "", text: this.getText("dmAllCategories") }].concat(aCategories.sort().map(function (sCategory) {
					return { key: sCategory, text: sCategory };
				})),
				chips: FILTERS.map(function (sKey) {
					return {
						key: sKey,
						selected: sKey === sFilter,
						text: this.getText("dmChip_" + sKey),
						// shown in the chip's count pill (see css/pages/policies-documents.css)
						count: String(aAll.filter(function (oDocument) {
							return Documents.matches(oDocument, oDocument.pct, sKey);
						}).length)
					};
				}, this),
				selected: oSelected || {},
				outstanding: oSelected ? oSelected.progress.outstanding : [],
				detailEmptyTitle: sEmptyTitle,
				detailEmptyText: sEmptyText
			});
		},

		_visibilityText: function (sVisibility) {
			return !sVisibility || sVisibility === "ALL" ? this.getText("dmAllEmployees") : ((this._mSites || {})[sVisibility] || sVisibility);
		},

		/* =========================================================== */
		/* list events                                                 */
		/* =========================================================== */

		onFilterChange: function () {
			this._render();
		},

		onChip: function (oEvent) {
			this.getModel("dmView").setProperty("/filter", oEvent.getSource().getBindingContext("dm").getProperty("key"));
			this._render();
		},

		onRemindRow: function (oEvent) {
			this._remind(oEvent.getSource().getBindingContext("dm").getObject());
		},

		onRemindSelected: function () {
			this._remind(this.getModel("dm").getProperty("/selected"));
		},

		/**
		 * Reminds everyone who has not acknowledged the document: sent by the HRX service,
		 * or a draft in the admin's own mail app (everyone in BCC) where it cannot send.
		 * @param {object} oDocument the document, as rendered
		 */
		_remind: function (oDocument) {
			var aOutstanding = (oDocument.progress ? oDocument.progress.outstanding : []).filter(function (oPerson) {
				return oPerson.Email;
			});

			if (!aOutstanding.length) {
				MessageToast.show(this.getText("dmEveryone"));
				return;
			}
			var sSubject = this.getText("dmRemindSubject", [oDocument.Name]);
			var sMessage = this.getText("dmRemindBody", [oDocument.Name]);
			Reminders.send({
				kind: "Policy",
				employeeIds: aOutstanding.map(function (oPerson) {
					return oPerson.EmpID;
				}),
				subject: sSubject,
				message: sMessage,
				draft: {
					bcc: aOutstanding.map(function (oPerson) {
						return oPerson.Email;
					}).join(","),
					subject: sSubject,
					body: sMessage
				}
			}).then(function (oResult) {
				if (oResult.outcome === "sent") {
					this._reportReminders(oResult);
				}
			}.bind(this)).catch(function (oError) {
				MessageBox.error(this.getText("reminderFailed", [oError.message]));
			}.bind(this));
		},

		/**
		 * Says how many reminders went, and who the service could not email.
		 * @param {object} oResult Reminders.send's answer: sent, failed
		 */
		_reportReminders: function (oResult) {
			if (oResult.failed.length) {
				MessageBox.warning(this.getText("reminderPartlySent", [oResult.sent, oResult.failed.join(", ")]));
				return;
			}
			MessageToast.show(this.getText("reminderSentCount", [oResult.sent]));
		},

		/**
		 * Unpublishes the selected document once confirmed. Its acknowledgement history
		 * is kept by the service.
		 */
		onRemove: function () {
			var oDocument = this.getModel("dm").getProperty("/selected");

			MessageBox.confirm(this.getText("dmRemoveConfirm", [oDocument.Name]), {
				title: this.getText("dmRemove"),
				emphasizedAction: MessageBox.Action.OK,
				onClose: function (sAction) {
					if (sAction !== MessageBox.Action.OK) {
						return;
					}
					DocumentService.remove({
						OrgID: this._oProfile.orgId,
						DocumentID: oDocument.DocumentID,
						RemovedBy: this._oProfile.email
					}).then(function () {
						MessageToast.show(this.getText("dmRemoved", [oDocument.Name]));
						this.getModel("dmView").setProperty("/selected", "");
						this._load();
					}.bind(this)).catch(function (oError) {
						this._showError("dmErrorRemove", oError);
					}.bind(this));
				}.bind(this)
			});
		},

		/* =========================================================== */
		/* upload                                                      */
		/* =========================================================== */

		/**
		 * The shell's top-bar action on this route, "Upload document".
		 */
		onPageAction: function () {
			if (this._oProfile && this._oProfile.isManager) {
				this.onOpenUpload();
			}
		},

		onOpenUpload: function () {
			this.setModel(new JSONModel({
				Name: "",
				Category: "Policy",
				Visibility: "ALL",
				AckRequired: true,
				file: null,
				canSave: false,
				saving: false,
				categories: Documents.CATEGORIES.map(function (sCategory) {
					return { key: sCategory, text: sCategory };
				}),
				// Every document is published to the whole organisation.
				audiences: [{ key: "ALL", text: this.getText("dmAllEmployees") }]
			}), "dmUpload");

			if (!this._pUploadDialog) {
				this._pUploadDialog = Fragment.load({
					id: this.getView().getId(),
					name: "bsx.hrx.hrx2026.fragment.DocumentUploadDialog",
					controller: this
				}).then(function (oDialog) {
					this.getView().addDependent(oDialog);
					return oDialog;
				}.bind(this));
			}
			this._pUploadDialog.then(function (oDialog) {
				this.byId("documentUploadFile").clear();
				this.byId("documentUploadFile").setValueState("None");
				this.byId("documentUploadName").setValueState("None");
				oDialog.open();
			}.bind(this));
		},

		onUploadInput: function () {
			var oUpload = this.getModel("dmUpload");
			oUpload.setProperty("/canSave", !!String(oUpload.getProperty("/Name") || "").trim() && !!oUpload.getProperty("/file"));
		},

		onUploadFileChange: function (oEvent) {
			var aFiles = oEvent.getParameter("files");
			var oFile = aFiles && aFiles[0];
			var oUpload = this.getModel("dmUpload");

			if (oFile && oFile.size > DocumentService.MAX_FILE_BYTES) {
				this.onUploadFileTooBig();
				oFile = null;
			}
			oUpload.setProperty("/file", oFile || null);
			// A name to start from: the file's own, without its extension.
			if (oFile && !String(oUpload.getProperty("/Name") || "").trim()) {
				oUpload.setProperty("/Name", oFile.name.replace(/\.[^.]+$/, ""));
			}
			this.onUploadInput();
		},

		onUploadFileRejected: function () {
			MessageBox.error(this.getText("dmFileWrongType"));
			this.getModel("dmUpload").setProperty("/file", null);
			this.onUploadInput();
		},

		onUploadFileTooBig: function () {
			MessageBox.error(this.getText("dmFileTooBig"));
			this.getModel("dmUpload").setProperty("/file", null);
			this.onUploadInput();
		},

		/**
		 * Publishes the document. As in the design, the button is always there to press:
		 * a missing name or file is pointed out instead of the button being greyed out.
		 */
		onConfirmUpload: function () {
			var oUpload = this.getModel("dmUpload");
			var oForm = oUpload.getData();
			var bName = !!String(oForm.Name || "").trim();
			var bFile = !!oForm.file;

			// Every missing field is marked at once; the toast names the first.
			RequiredFields.mark(this.byId("documentUploadName"), bName);
			RequiredFields.mark(this.byId("documentUploadFile"), bFile);
			if (!bName || !bFile) {
				Toast.error(this.getText(bName ? "dmNeedFile" : "dmNeedName"));
				return;
			}

			oUpload.setProperty("/saving", true);

			DocumentService.upload({
				OrgID: this._oProfile.orgId,
				Name: oForm.Name.trim(),
				Category: oForm.Category,
				Visibility: oForm.Visibility,
				AckRequired: oForm.AckRequired,
				PublishedBy: this._oProfile.email,
				file: oForm.file
			}).then(function (oResult) {
				oUpload.setProperty("/saving", false);
				this.byId("documentUploadDialog").close();
				MessageToast.show(this.getText("dmPublishedToast", [oForm.Name.trim()]));
				var sNewId = oResult && oResult.data && oResult.data.DocumentID;
				var oViewModel = this.getModel("dmView");
				oViewModel.setProperty("/filter", "all");
				oViewModel.setProperty("/q", "");
				oViewModel.setProperty("/selected", sNewId || "");
				this._load();
			}.bind(this)).catch(function (oError) {
				oUpload.setProperty("/saving", false);
				this._showError("dmErrorUpload", oError);
			}.bind(this));
		},

		onCancelUpload: function () {
			this.byId("documentUploadDialog").close();
		},

		/* =========================================================== */
		/* helpers                                                     */
		/* =========================================================== */

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
