sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/format/DateFormat",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"../model/ExpenseService",
	"../model/ExpenseClaims"
], function (Controller, DateFormat, JSONModel, MessageBox, MessageToast, ExpenseService, ExpenseClaims) {
	"use strict";

	var oDisplayDate = DateFormat.getDateInstance({ pattern: "d MMM yyyy" });
	var oIsoDate = DateFormat.getDateInstance({ pattern: "yyyy-MM-dd" });

	// Changes are written to the claim's draft this long after the last keystroke
	var SAVE_DELAY_MS = 700;

	// While the launchpad is still updating after a deploy, the page loads again this often
	var UPDATING_RETRY_MS = 20000;

	// A photo is shrunk to this size before it is read, which keeps the upload small
	// on a slow connection; the AI reads it just as well (same sizes as the old app).
	var READ_MAX_PX = 1100;
	var READ_JPEG_QUALITY = 0.7;

	// Currencies a receipt can be paid in. The claim is always in the site's currency;
	// anything else is converted at that day's rate by the service.
	var CURRENCIES = [
		{ code: "GBP", text: "GBP — British pound" },
		{ code: "INR", text: "INR — Indian rupee" },
		{ code: "EUR", text: "EUR — Euro" },
		{ code: "USD", text: "USD — US dollar" },
		{ code: "PLN", text: "PLN — Polish złoty" },
		{ code: "CHF", text: "CHF — Swiss franc" },
		{ code: "AED", text: "AED — UAE dirham" }
	];

	var COUNTRY_NAMES = { UK: "United Kingdom", IN: "India" };

	function displayDate(sIso) {
		var oDate = sIso ? oIsoDate.parse(String(sIso).slice(0, 10)) : null;
		return oDate ? oDisplayDate.format(oDate) : "";
	}

	/** @returns {Promise<{base64: string, mimeType: string}>} the file, ready to be read */
	function fileForReading(oFile) {
		if (oFile.type === "application/pdf") {
			return new Promise(function (resolve, reject) {
				var oReader = new FileReader();
				oReader.onload = function () {
					resolve({ base64: String(oReader.result).split(",")[1], mimeType: "application/pdf" });
				};
				oReader.onerror = reject;
				oReader.readAsDataURL(oFile);
			});
		}
		// A photo: draw it no larger than READ_MAX_PX and send it as a JPEG
		return createImageBitmap(oFile).then(function (oBitmap) {
			var fScale = Math.min(1, READ_MAX_PX / Math.max(oBitmap.width, oBitmap.height));
			var oCanvas = document.createElement("canvas");
			oCanvas.width = Math.round(oBitmap.width * fScale);
			oCanvas.height = Math.round(oBitmap.height * fScale);
			oCanvas.getContext("2d").drawImage(oBitmap, 0, 0, oCanvas.width, oCanvas.height);
			var sDataUrl = oCanvas.toDataURL("image/jpeg", READ_JPEG_QUALITY);
			return { base64: sDataUrl.split(",")[1], mimeType: "image/jpeg" };
		});
	}

	/*
	 * Expenses: the employee's own claims. My claims lists them, Summary adds them up,
	 * and a claim opens in the editor, where every change is saved to the claim's
	 * draft as it is made ("Saved just now"); leaving the editor saves the claim, and
	 * Apply for approval saves it and sends it to the approver.
	 */
	return Controller.extend("bsx.hrx.hrx2026.controller.Expenses", {

		onInit: function () {
			this.getView().setModel(new JSONModel({
				busy: false,
				error: "",
				panel: "list",
				itemMode: "lines",
				readOnly: true,
				showErrors: false,
				savedText: "",
				filters: { from: "", to: "", status: "All", query: "" },
				statusOptions: [{ key: "All", text: this._text("exStatusAll") }].concat(Object.keys(ExpenseClaims.STATUS).map(function (sKey) {
					return { key: sKey, text: ExpenseClaims.STATUS[sKey].text };
				}))
			}), "exView");
			this.getView().setModel(new JSONModel({
				claims: [],
				rows: [],
				listHint: "",
				summary: { byType: [], attentionRows: [] },
				types: [],
				currencies: CURRENCIES,
				claim: null
			}), "ex");

			this._mTypes = {};
			this._mPolicies = {};
			this._aTaxTypes = [];
			this._pWrites = Promise.resolve();
			this._mPendingChanges = {};

			this.getOwnerComponent().getRouter().getRoute("expenses").attachPatternMatched(this._onRouteMatched, this);

			// The top bar's buttons follow the panel, and on a claim it shows whether the
			// claim is saved, as the design has them
			this._viewModel().bindProperty("/panel").attachChange(this._publishTopBar, this);
			// A new panel starts at its top, not where the last one was scrolled to
			this._viewModel().bindProperty("/panel").attachChange(this._scrollToTop, this);
			this._viewModel().bindProperty("/savedText").attachChange(this._publishTopBar, this);
			this._viewModel().bindProperty("/readOnly").attachChange(this._publishTopBar, this);
		},

		/**
		 * The top bar for the panel on screen (the design's renderTop): Refresh and
		 * Create on My claims, Create on Summary, the saved state on a claim being edited.
		 */
		_publishTopBar: function () {
			var oViewModel = this._viewModel();
			var sPanel = oViewModel.getProperty("/panel");
			var oRefresh = { key: "refresh", text: this._text("exRefresh"), icon: "sap-icon://refresh", primary: false };
			var oCreate = { key: "create", text: this._text("exCreate"), icon: "sap-icon://add", primary: true };
			var oTopBar = { stamp: "", buttons: [] };

			if (sPanel === "list") {
				oTopBar.buttons = [oRefresh, oCreate];
			} else if (sPanel === "summary") {
				oTopBar.buttons = [oCreate];
			} else if (!oViewModel.getProperty("/readOnly")) {
				oTopBar.stamp = oViewModel.getProperty("/savedText");
			}

			var oApp = this.getOwnerComponent().getRootControl().getController();
			if (oApp && oApp.setTopBar) {
				oApp.setTopBar("expenses", oTopBar);
			}
		},

		/** Scrolls the page (or, on a phone, its scroll area) back to the top. */
		_scrollToTop: function () {
			var oDomRef = this.getView().getDomRef();
			if (!oDomRef) {
				return;
			}
			oDomRef.querySelectorAll(".sapMPageEnableScrolling, .hrxMbContent").forEach(function (oScroller) {
				oScroller.scrollTop = 0;
			});
		},

		/**
		 * A press on one of this page's top bar buttons (App.controller onTopBarButton).
		 * @param {string} sKey refresh or create
		 */
		onTopBarButton: function (sKey) {
			if (sKey === "create") {
				this.onCreateClaim();
			} else if (sKey === "refresh") {
				this._load();
			}
		},

		_text: function (sKey, aArgs) {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(sKey, aArgs);
		},

		_model: function () {
			return this.getView().getModel("ex");
		},

		_viewModel: function () {
			return this.getView().getModel("exView");
		},

		_onRouteMatched: function () {
			this._viewModel().setProperty("/panel", "list");
			// The shell has just cleared the top bar for the new route
			this._publishTopBar();
			this._load();
		},

		/* ═════════════ Loading ═════════════ */

		_load: function () {
			var oViewModel = this._viewModel();
			oViewModel.setProperty("/busy", true);
			oViewModel.setProperty("/error", "");

			var pSetup = this._pSetup || Promise.all([ExpenseService.whoAmI(), ExpenseService.lookups()]).then(function (aAnswers) {
				this._oMe = aAnswers[0];
				this._sCountry = ExpenseClaims.countryOfSite(this._oMe.site);
				var oLookups = aAnswers[1];
				oLookups.types.forEach(function (oType) {
					this._mTypes[oType.code] = oType;
				}.bind(this));
				oLookups.policies.forEach(function (oPolicy) {
					this._mPolicies[oPolicy.country] = oPolicy;
				}.bind(this));
				this._aTaxTypes = oLookups.taxTypes;
				this._model().setProperty("/types", oLookups.types);
			}.bind(this));
			this._pSetup = pSetup;

			return pSetup.then(function () {
				return ExpenseService.myClaims();
			}).then(function (aClaims) {
				this._model().setProperty("/claims", aClaims);
				this._applyFilters();
				this._buildSummary();
			}.bind(this)).catch(function (oError) {
				this._pSetup = null;
				// 401/403: the user has not been given an expense role in BTP yet
				var bNoRole = oError.status === 401 || oError.status === 403;
				if (oError.status === 503) {
					// Just deployed: the launchpad is still updating its routes. Say so,
					// and load again shortly without the user having to.
					oViewModel.setProperty("/error", this._text("exUpdating"));
					clearTimeout(this._iReloadTimer);
					this._iReloadTimer = setTimeout(this._load.bind(this), UPDATING_RETRY_MS);
				} else {
					oViewModel.setProperty("/error", bNoRole ? this._text("exNoAccess") : this._text("exLoadError", [oError.message]));
				}
			}.bind(this)).finally(function () {
				oViewModel.setProperty("/busy", false);
			});
		},

		_taxRateFor: function (sCountry) {
			var aTaxTypes = this._aTaxTypes;
			return function (sVatType) {
				var oTaxType = aTaxTypes.find(function (oCandidate) {
					return oCandidate.country === sCountry && oCandidate.code === (sVatType || "STD");
				});
				return oTaxType ? Number(oTaxType.rate) : 0;
			};
		},

		_checkContext: function (oClaim) {
			return {
				items: oClaim.items || [],
				policy: this._mPolicies[oClaim.country] || {},
				types: this._mTypes,
				currency: oClaim.currency
			};
		},

		/* ═════════════ My claims ═════════════ */

		onTabPress: function (oEvent) {
			this._viewModel().setProperty("/panel", oEvent.getSource().data("tab"));
		},

		onFilterChange: function () {
			this._applyFilters();
		},

		onClearFilters: function () {
			this._viewModel().setProperty("/filters", { from: "", to: "", status: "All", query: "" });
			this._applyFilters();
		},

		_applyFilters: function () {
			var oFilters = this._viewModel().getProperty("/filters");
			var sQuery = (oFilters.query || "").trim().toLowerCase();
			var aClaims = this._model().getProperty("/claims");

			var aShown = aClaims.filter(function (oClaim) {
				var sPeriod = String(oClaim.claimPeriod || "");
				return (oFilters.status === "All" || oClaim.status === oFilters.status) &&
					(!oFilters.from || sPeriod >= oFilters.from) &&
					(!oFilters.to || sPeriod <= oFilters.to) &&
					(!sQuery || String(oClaim.claimNumber || "").toLowerCase().indexOf(sQuery) >= 0);
			});

			var aRows = aShown.map(function (oClaim) {
				var oTotals = ExpenseClaims.claimTotals(oClaim, this._taxRateFor(oClaim.country));
				var oStatus = ExpenseClaims.statusOf(oClaim.status);
				return {
					ID: oClaim.ID,
					numberText: oClaim.claimNumber || this._text("exUnsaved"),
					periodText: displayDate(oClaim.claimPeriod),
					statusText: oStatus.text,
					statusState: oStatus.state,
					statusPill: ExpenseClaims.pillOf(oStatus.state),
					netText: ExpenseClaims.money(oTotals.net, oClaim.currency),
					taxText: ExpenseClaims.money(oTotals.tax, oClaim.currency),
					totalText: ExpenseClaims.money(oTotals.total, oClaim.currency)
				};
			}.bind(this));

			var iPending = aShown.filter(function (oClaim) { return ExpenseClaims.isPending(oClaim.status); }).length;
			var iApproved = aShown.filter(function (oClaim) { return oClaim.status === "Approved"; }).length;

			this._model().setProperty("/rows", aRows);
			this._model().setProperty("/listHint", this._text("exListHint", [aRows.length, iPending, iApproved]));
		},

		onOpenClaim: function (oEvent) {
			var sId = oEvent.getParameter("listItem").getBindingContext("ex").getProperty("ID");
			this._openClaim(sId);
		},

		onOpenAttention: function (oEvent) {
			this._openClaim(oEvent.getSource().getParent().getParent().data("claim"));
		},

		/* ═════════════ Summary ═════════════ */

		/**
		 * Amounts kept per currency, as text: the home currency first, others only when
		 * there are any (a UK and an India claim can't be added together).
		 * @param {object} oSums currency → amount, e.g. { GBP: 55.1, INR: 10391.57 }
		 * @returns {string} e.g. "£55.10 · ₹10,391.57"
		 */
		_moneyByCurrency: function (oSums) {
			var sHome = ExpenseClaims.CURRENCY_OF_COUNTRY[this._sCountry];
			var aCurrencies = [sHome].concat(Object.keys(oSums).filter(function (sCurrency) {
				return sCurrency !== sHome;
			}));
			var aTexts = aCurrencies.filter(function (sCurrency) {
				return sCurrency === sHome || Number(oSums[sCurrency]) > 0;
			}).map(function (sCurrency) {
				return ExpenseClaims.money(oSums[sCurrency] || 0, sCurrency);
			});
			// Nothing at home but something abroad: leave out the home zero
			if (aTexts.length > 1 && !(Number(oSums[sHome]) > 0)) {
				aTexts.shift();
			}
			return aTexts.join(" \u00b7 ");
		},

		_buildSummary: function () {
			var aClaims = this._model().getProperty("/claims");
			var oSummary = { approved: {}, nApproved: 0, pending: {}, nPending: 0, tax: {}, byType: {}, attentionRows: [] };
			var fnAdd = function (oSums, sCurrency, fAmount) {
				oSums[sCurrency] = (oSums[sCurrency] || 0) + (Number(fAmount) || 0);
			};

			aClaims.forEach(function (oClaim) {
				var oTotals = ExpenseClaims.claimTotals(oClaim, this._taxRateFor(oClaim.country));
				var sCurrency = oClaim.currency;
				if (oClaim.status === "Approved") {
					fnAdd(oSummary.approved, sCurrency, oTotals.total);
					oSummary.nApproved++;
				}
				if (ExpenseClaims.isPending(oClaim.status)) {
					fnAdd(oSummary.pending, sCurrency, oTotals.total);
					oSummary.nPending++;
				}
				if (oClaim.status === "Approved" || ExpenseClaims.isPending(oClaim.status)) {
					fnAdd(oSummary.tax, sCurrency, oTotals.tax);
				}
				if (oClaim.status !== "Rejected") {
					(oClaim.items || []).forEach(function (oItem) {
						var sType = (this._mTypes[oItem.expenseType_code] || {}).description || this._text("exUntyped");
						oSummary.byType[sType] = oSummary.byType[sType] || {};
						fnAdd(oSummary.byType[sType], sCurrency, oItem.grossAmount);
					}.bind(this));
					(oClaim.mileageClaims || []).forEach(function (oMileage) {
						var sMileage = this._text("exMileage");
						oSummary.byType[sMileage] = oSummary.byType[sMileage] || {};
						fnAdd(oSummary.byType[sMileage], sCurrency, oMileage.totalAmount);
					}.bind(this));
				}
				if (ExpenseClaims.isEditable(oClaim.status)) {
					var oContext = this._checkContext(oClaim);
					(oClaim.items || []).forEach(function (oItem) {
						var oChecks = ExpenseClaims.itemChecks(oItem, oContext);
						var aMissing = ExpenseClaims.missingItemFields(oItem);
						if (oChecks.you.length || aMissing.length) {
							oSummary.attentionRows.push({
								claimId: oClaim.ID,
								title: ((this._mTypes[oItem.expenseType_code] || {}).description || this._text("exUntyped")) +
									" · " + (oClaim.claimNumber || this._text("exUnsaved")),
								issue: oChecks.you.length ? oChecks.you[0].label : this._text("exMissingFields"),
								amountText: ExpenseClaims.money(oItem.grossAmount, oClaim.currency)
							});
						}
					}.bind(this));
				}
			}.bind(this));

			// Each bar is drawn against the largest amount in its own currency
			var aTypes = Object.keys(oSummary.byType);
			var oLargest = {};
			aTypes.forEach(function (sType) {
				Object.keys(oSummary.byType[sType]).forEach(function (sCurrency) {
					oLargest[sCurrency] = Math.max(oLargest[sCurrency] || 1, oSummary.byType[sType][sCurrency]);
				});
			});
			var fnShare = function (sType) {
				var oSums = oSummary.byType[sType];
				return Math.max.apply(null, Object.keys(oSums).map(function (sCurrency) {
					return oSums[sCurrency] / oLargest[sCurrency];
				}));
			};
			aTypes.sort(function (a, b) {
				return fnShare(b) - fnShare(a);
			});

			this._model().setProperty("/summary", {
				approvedText: this._moneyByCurrency(oSummary.approved),
				approvedSub: this._text(oSummary.nApproved === 1 ? "exOneClaim" : "exClaims", [oSummary.nApproved]),
				pendingText: this._moneyByCurrency(oSummary.pending),
				pendingSub: this._text(oSummary.nPending === 1 ? "exOneClaim" : "exClaims", [oSummary.nPending]),
				taxLabel: this._text(this._sCountry === "IN" ? "exKpiGst" : "exKpiVat"),
				taxText: this._moneyByCurrency(oSummary.tax),
				attention: oSummary.attentionRows.length,
				attentionRows: oSummary.attentionRows,
				byType: aTypes.map(function (sType) {
					return {
						type: sType,
						amountText: this._moneyByCurrency(oSummary.byType[sType]),
						percent: Math.round(fnShare(sType) * 100)
					};
				}.bind(this))
			});
		},

		/* ═════════════ Opening, creating and leaving a claim ═════════════ */

		onCreateClaim: function () {
			this._createClaim().catch(this._showError.bind(this));
		},

		/**
		 * Starts a new claim as a draft, in the employee's country, and opens it.
		 * @returns {Promise<object>} the new draft claim
		 */
		_createClaim: function () {
			var oViewModel = this._viewModel();
			oViewModel.setProperty("/busy", true);
			return ExpenseService.createClaim({
				country: this._sCountry,
				claimPeriod: ExpenseClaims.todayIso(),
				currency: ExpenseClaims.CURRENCY_OF_COUNTRY[this._sCountry]
			}).then(function (oDraft) {
				oDraft.items = [];
				oDraft.mileageClaims = [];
				this._showClaim(oDraft, false, true);
				return oDraft;
			}.bind(this)).finally(function () {
				oViewModel.setProperty("/busy", false);
			});
		},

		/**
		 * Phone, on the claims list: photograph a receipt straight into a new claim.
		 * The camera has to open as part of the tap itself, so the claim is created
		 * once the photo has been taken.
		 */
		onPhotographNewClaim: function () {
			this._pickFiles(false, function (aFiles) {
				this._createClaim().then(function () {
					this._readReceipts(aFiles);
				}.bind(this)).catch(this._showError.bind(this));
			}.bind(this), true);
		},

		/** Phone, in a claim: photograph a receipt; it is read into a new line. */
		onPhotographReceipt: function () {
			this._pickFiles(false, this._readReceipts.bind(this), true);
		},

		/**
		 * Opens a claim: one that can still be changed opens as its draft, any other
		 * just to read.
		 * @param {string} sId the claim
		 */
		_openClaim: function (sId) {
			var oListed = this._model().getProperty("/claims").find(function (oClaim) {
				return oClaim.ID === sId;
			});
			if (!oListed) {
				return;
			}
			var oViewModel = this._viewModel();
			oViewModel.setProperty("/busy", true);

			var pClaim;
			if (!ExpenseClaims.isEditable(oListed.status)) {
				pClaim = ExpenseService.claim(sId, true);
			} else if (oListed.IsActiveEntity === false) {
				pClaim = ExpenseService.claim(sId, false);
			} else {
				pClaim = ExpenseService.editClaim(sId).then(function () {
					return ExpenseService.claim(sId, false);
				});
			}

			pClaim.then(function (oClaim) {
				this._showClaim(oClaim, !ExpenseClaims.isEditable(oClaim.status), false);
			}.bind(this)).catch(this._showError.bind(this)).finally(function () {
				oViewModel.setProperty("/busy", false);
			});
		},

		_showClaim: function (oClaim, bReadOnly, bNew) {
			var oViewModel = this._viewModel();
			this._bNewClaim = bNew;
			this._mPendingChanges = {};
			oClaim.items.forEach(function (oItem) {
				oItem.open = false;
				oItem.dismissed = [];
			});
			this._model().setProperty("/claim", oClaim);
			oViewModel.setProperty("/readOnly", bReadOnly);
			oViewModel.setProperty("/showErrors", false);
			oViewModel.setProperty("/savedText", this._text("exAutoSave"));
			oViewModel.setProperty("/panel", "claim");
			this._decorate();
		},

		onBack: function () {
			var oClaim = this._model().getProperty("/claim");
			if (this._viewModel().getProperty("/readOnly")) {
				this._backToList();
				return;
			}
			var bEmpty = !oClaim.items.length && !oClaim.mileageClaims.length;
			this._viewModel().setProperty("/busy", true);

			this._flushChanges().then(function () {
				// A new claim nothing was added to is just thrown away
				if (this._bNewClaim && bEmpty) {
					return ExpenseService.discardDraft(oClaim.ID);
				}
				return ExpenseService.saveClaim(oClaim.ID);
			}.bind(this)).then(function () {
				this._backToList();
			}.bind(this)).catch(this._showError.bind(this)).finally(function () {
				this._viewModel().setProperty("/busy", false);
			}.bind(this));
		},

		_backToList: function () {
			this._model().setProperty("/claim", null);
			this._viewModel().setProperty("/panel", "list");
			this._load();
		},

		onDeleteClaim: function () {
			var oClaim = this._model().getProperty("/claim");
			MessageBox.confirm(this._text("exDeleteConfirm"), {
				title: this._text("exDeleteDraft"),
				actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
				emphasizedAction: MessageBox.Action.DELETE,
				onClose: function (sAction) {
					if (sAction !== MessageBox.Action.DELETE) {
						return;
					}
					this._viewModel().setProperty("/busy", true);
					this._pWrites.then(function () {
						return ExpenseService.discardDraft(oClaim.ID);
					}).then(function () {
						// A claim that was saved before goes too
						return this._bNewClaim ? null : ExpenseService.deleteClaim(oClaim.ID);
					}.bind(this)).then(function () {
						MessageToast.show(this._text("exDeleted"));
						this._backToList();
					}.bind(this)).catch(this._showError.bind(this)).finally(function () {
						this._viewModel().setProperty("/busy", false);
					}.bind(this));
				}.bind(this)
			});
		},

		/* ═════════════ Working out what the claim screen shows ═════════════ */

		/**
		 * Recomputes everything the claim screen shows from the claim's own fields:
		 * line texts, the checks on each line, totals and what is left to do.
		 */
		_decorate: function () {
			var oModel = this._model();
			var oClaim = oModel.getProperty("/claim");
			if (!oClaim) {
				return;
			}
			var fnTaxRate = this._taxRateFor(oClaim.country);
			var oContext = this._checkContext(oClaim);
			var bShowErrors = this._viewModel().getProperty("/showErrors");
			var oStatus = ExpenseClaims.statusOf(oClaim.status);

			oClaim.statusText = oStatus.text;
			oClaim.statusState = oStatus.state;
			oClaim.statusPill = ExpenseClaims.pillOf(oStatus.state);
			oClaim.countryName = COUNTRY_NAMES[oClaim.country] || oClaim.country;
			oClaim.employeeName = oClaim.employeeName || this._oMe.fullName;
			oClaim.employeeNumber = oClaim.employeeNumber || this._oMe.employeeNumber;
			oClaim.taxTypes = this._aTaxTypes.filter(function (oTaxType) {
				return oTaxType.country === oClaim.country;
			}).map(function (oTaxType) {
				return { code: oTaxType.code, text: oTaxType.description + " (" + Math.round(Number(oTaxType.rate) * 100) + "%)" };
			});

			if (oClaim.status === "Returned") {
				oClaim.banner = this._text("exBannerReturned", [oClaim.rejectionReason || ""]);
				oClaim.bannerType = "Warning";
			} else if (oClaim.status === "Rejected") {
				oClaim.banner = this._text("exBannerRejected", [oClaim.rejectionReason || ""]);
				oClaim.bannerType = "Error";
			} else if (!ExpenseClaims.isEditable(oClaim.status)) {
				oClaim.banner = this._text("exBannerReadOnly", [oStatus.text]);
				oClaim.bannerType = "Information";
			} else {
				oClaim.banner = "";
			}

			oClaim.items.forEach(function (oItem) {
				var oType = this._mTypes[oItem.expenseType_code];
				var oSplit = ExpenseClaims.taxSplit(oItem.grossAmount, fnTaxRate(oItem.vatType));
				var oChecks = ExpenseClaims.itemChecks(oItem, oContext);
				var aMissing = ExpenseClaims.missingItemFields(oItem);
				var bForeign = !!oItem.originalCurrency && oItem.originalCurrency !== oClaim.currency;

				oItem.paidCurrency = oItem.originalCurrency || oClaim.currency;
				oItem.typeText = oType ? oType.description : this._text("exChooseType");
				oItem.subText = [displayDate(oItem.expenseDate), oItem.destination].filter(Boolean).join(" · ");
				oItem.grossText = ExpenseClaims.money(oItem.grossAmount, oClaim.currency);
				oItem.netText = ExpenseClaims.money(oSplit.net, oClaim.currency);
				oItem.taxLineText = this._text("exTaxOf", [
					this._text(oClaim.country === "IN" ? "exGst" : "exVat"),
					ExpenseClaims.money(oSplit.tax, oClaim.currency)
				]);
				oItem.fxText = bForeign && oItem.originalAmount ? ExpenseClaims.money(oItem.originalAmount, oItem.originalCurrency) : "";
				// Under the amount, as the design has it: what was paid abroad, else the tax in it
				oItem.amountSubText = oItem.fxText || oItem.taxLineText;
				oItem.splitText = this._text("exSplit", [
					ExpenseClaims.money(oSplit.net, oClaim.currency),
					ExpenseClaims.money(oSplit.tax, oClaim.currency),
					ExpenseClaims.money(oSplit.gross, oClaim.currency)
				]);
				if (ExpenseClaims.isFromScreenshot(oItem)) {
					oItem.aiText = this._text("exFromScreenshot");
				} else {
					oItem.aiText = oItem.scanConfidence !== undefined && oItem.scanConfidence !== null
						? this._text("exReadFromReceipt", [Math.round(oItem.scanConfidence * 100)]) : "";
				}

				// What to fix shows on the line; once there is nothing to fix, the line
				// says it is fine. Missing fields count once the employee tries to submit.
				oItem.issues = oChecks.you.concat(oChecks.fyi);
				oItem.okChecks = oChecks.checks.filter(function (oCheck) {
					return oCheck.status === "ok" || oCheck.status === "info";
				});
				if (oChecks.state === "none" && !aMissing.length) {
					oItem.stateText = "";
				} else if (oChecks.you.length || (aMissing.length && bShowErrors)) {
					oItem.stateText = this._text("exStateFix", [oChecks.you.length + (aMissing.length ? 1 : 0)]);
					oItem.stateState = "Warning";
				} else if (aMissing.length) {
					oItem.stateText = this._text("exStateIncomplete");
					oItem.stateState = "None";
				} else {
					oItem.stateText = this._text("exStateOk");
					oItem.stateState = "Success";
				}
				oItem.statePill = ExpenseClaims.pillOf(oItem.stateState);
			}.bind(this));

			var oPolicy = this._mPolicies[oClaim.country] || {};
			oClaim.mileageClaims.forEach(function (oMileage) {
				var fAmount = ExpenseClaims.round2((Number(oMileage.milesCount) || 0) * (Number(oMileage.ratePerMile) || 0));
				oMileage.rateText = ExpenseClaims.money(oMileage.ratePerMile || oPolicy.mileageRate, oClaim.currency);
				oMileage.amountText = ExpenseClaims.money(fAmount, oClaim.currency);
			});

			var oTotals = ExpenseClaims.claimTotals(oClaim, fnTaxRate);
			var oReady = ExpenseClaims.readiness(oClaim, oContext);
			var sTaxName = this._text(oClaim.country === "IN" ? "exGst" : "exVat");
			oClaim.totalText = ExpenseClaims.money(oTotals.total, oClaim.currency);
			oClaim.totalSub = this._text("exTotalSub", [ExpenseClaims.money(oTotals.net, oClaim.currency), sTaxName, ExpenseClaims.money(oTotals.tax, oClaim.currency)]);
			oClaim.itemsHint = this._text(oClaim.items.length === 1 ? "exOneItem" : "exItemCount", [oClaim.items.length]);
			oClaim.mileageHint = this._text(oClaim.mileageClaims.length === 1 ? "exOneTrip" : "exTripCount", [oClaim.mileageClaims.length]);

			if (oReady.reading) {
				oClaim.readyText = this._text("exReadyReading", [oReady.reading]);
				oClaim.readyState = "wait";
			} else if (oReady.empty) {
				oClaim.readyText = this._text("exReadyEmpty");
				oClaim.readyState = "idle";
			} else if (oReady.toFix) {
				oClaim.readyText = this._text(oReady.toFix === 1 ? "exReadyOneToFix" : "exReadyToFix", [oReady.toFix]);
				oClaim.readyState = "fix";
			} else {
				oClaim.readyText = this._text("exReadyOk");
				oClaim.readyState = "ok";
			}
			oClaim.flaggedText = oReady.flagged ? this._text("exReadyFlagged", [oReady.flagged]) : "";
			this._oReadiness = oReady;

			// Forced: items and mileage are changed in place, which a plain refresh
			// does not notice (it compares the arrays, not what is in them)
			oModel.refresh(true);
		},

		/* ═════════════ Saving changes as they are made ═════════════ */

		/**
		 * Runs a write after every write before it, so they reach the service in order
		 * and nothing is saved while an upload is still going.
		 * @param {function} fnWrite returns a promise
		 * @returns {Promise} the write
		 */
		_queueWrite: function (fnWrite) {
			var pWrite = this._pWrites.then(fnWrite);
			this._pWrites = pWrite.catch(function () {
				return null;
			});
			return pWrite;
		},

		/**
		 * Notes a change to a claim, item or mileage line and writes it shortly after
		 * the last keystroke.
		 * @param {string} sKind "claim", "item" or "mileage"
		 * @param {string} sId the row
		 * @param {object} oChanges the fields that changed
		 */
		_changed: function (sKind, sId, oChanges) {
			var sKey = sKind + ":" + sId;
			if (!this._mPendingChanges[sKey]) {
				this._mPendingChanges[sKey] = { kind: sKind, id: sId, fields: {} };
			}
			Object.assign(this._mPendingChanges[sKey].fields, oChanges);
			this._viewModel().setProperty("/savedText", this._text("exSaving"));
			clearTimeout(this._iSaveTimer);
			this._iSaveTimer = setTimeout(this._flushChanges.bind(this), SAVE_DELAY_MS);
		},

		/** Writes every change not yet written. @returns {Promise} once all are written */
		_flushChanges: function () {
			clearTimeout(this._iSaveTimer);
			var aChanges = Object.keys(this._mPendingChanges).map(function (sKey) {
				return this._mPendingChanges[sKey];
			}.bind(this));
			this._mPendingChanges = {};
			var oClaim = this._model().getProperty("/claim");

			aChanges.forEach(function (oChange) {
				this._queueWrite(function () {
					if (oChange.kind === "claim") {
						return ExpenseService.updateClaimDraft(oClaim.ID, oChange.fields);
					}
					if (oChange.kind === "item") {
						return ExpenseService.updateItem(oChange.id, oChange.fields);
					}
					return ExpenseService.updateMileage(oChange.id, oChange.fields);
				}).catch(this._showError.bind(this));
			}.bind(this));

			return this._pWrites.then(function () {
				this._viewModel().setProperty("/savedText", this._text("exSaved"));
			}.bind(this));
		},

		onCountryChange: function (oEvent) {
			var oClaim = this._model().getProperty("/claim");
			oClaim.country = oEvent.getSource().getSelectedKey();
			oClaim.currency = ExpenseClaims.CURRENCY_OF_COUNTRY[oClaim.country];
			this._changed("claim", oClaim.ID, { country: oClaim.country, currency: oClaim.currency });
			this._decorate();
		},

		onClaimPeriodChange: function (oEvent) {
			var oClaim = this._model().getProperty("/claim");
			oClaim.claimPeriod = this._fieldValue(oEvent.getSource());
			this._changed("claim", oClaim.ID, { claimPeriod: oClaim.claimPeriod });
			this._decorate();
		},

		/* ═════════════ Expense items ═════════════ */

		_itemOf: function (oControl) {
			return oControl.getBindingContext("ex").getObject();
		},

		/** @returns {number|null} a typed amount as a number, or null when there is none */
		_numberOrNull: function (vValue) {
			return vValue === "" || vValue === null || vValue === undefined || isNaN(Number(vValue)) ? null : Number(vValue);
		},

		onAddItem: function () {
			var oClaim = this._model().getProperty("/claim");
			this._queueWrite(function () {
				return ExpenseService.addItem(oClaim.ID, { expenseDate: ExpenseClaims.todayIso(), vatType: "STD" });
			}).then(function (oItem) {
				oItem.open = true;
				oItem.dismissed = [];
				oClaim.items.push(oItem);
				this._decorate();
			}.bind(this)).catch(this._showError.bind(this));
		},

		/**
		 * What a field holds now. Read from the control itself: an Input only copies
		 * its text into the model when it loses focus, and changes are saved as they
		 * are typed.
		 * @param {sap.ui.core.Control} oControl the field
		 * @returns {string|null} its value, null when empty
		 */
		_fieldValue: function (oControl) {
			// A Select gives its chosen key; an Input or DatePicker its text (an Input
			// has a getSelectedKey too, for suggestions, so the type decides)
			var sValue = oControl.isA("sap.m.Select") ? oControl.getSelectedKey() : oControl.getValue();
			return sValue === "" ? null : sValue;
		},

		onItemFieldChange: function (oEvent) {
			var oControl = oEvent.getSource();
			var oItem = this._itemOf(oControl);
			var sField = oControl.data("field");
			var vValue = this._fieldValue(oControl);
			if (sField === "grossAmount") {
				vValue = this._numberOrNull(vValue);
			}
			oItem[sField] = vValue;

			var oChanges = {};
			oChanges[sField] = vValue;
			this._changed("item", oItem.ID, oChanges);
			this._decorate();
		},

		onItemCurrencyChange: function (oEvent) {
			var oItem = this._itemOf(oEvent.getSource());
			var oClaim = this._model().getProperty("/claim");
			var sCurrency = oEvent.getSource().getSelectedKey();

			if (sCurrency === oClaim.currency) {
				// Paid at home: no conversion, the usual tax
				Object.assign(oItem, { originalCurrency: null, originalAmount: null, fxRate: null, fxTargetCurrency: null, vatType: "STD" });
				this._changed("item", oItem.ID, { originalCurrency: null, originalAmount: null, fxRate: null, fxTargetCurrency: null, vatType: "STD" });
			} else {
				// Paid abroad: foreign tax can't be reclaimed, so the line is zero rated
				Object.assign(oItem, { originalCurrency: sCurrency, vatType: "ZR" });
				this._changed("item", oItem.ID, { originalCurrency: sCurrency, vatType: "ZR" });
				if (oItem.originalAmount) {
					this._convert(oItem);
				}
			}
			this._decorate();
		},

		onForeignAmountChange: function (oEvent) {
			var oItem = this._itemOf(oEvent.getSource());
			oItem.originalAmount = this._numberOrNull(this._fieldValue(oEvent.getSource()));
			this._changed("item", oItem.ID, { originalAmount: oItem.originalAmount });
			if (oItem.originalAmount) {
				this._convert(oItem);
			}
			this._decorate();
		},

		/** Converts a foreign amount into the claim's currency at that day's rate. */
		_convert: function (oItem) {
			var oClaim = this._model().getProperty("/claim");
			ExpenseService.convertCurrency(oItem.originalAmount, oItem.originalCurrency, oClaim.currency,
				oItem.expenseDate || ExpenseClaims.todayIso()).then(function (oRate) {
				oItem.grossAmount = Number(oRate.convertedAmount);
				oItem.fxRate = Number(oRate.rate);
				oItem.fxTargetCurrency = oClaim.currency;
				this._changed("item", oItem.ID, { grossAmount: oItem.grossAmount, fxRate: oItem.fxRate, fxTargetCurrency: oClaim.currency });
				this._decorate();
			}.bind(this)).catch(function (oError) {
				MessageToast.show(this._text("exConvertError", [oError.message]));
			}.bind(this));
		},

		onToggleItem: function (oEvent) {
			var oItem = this._itemOf(oEvent.getSource());
			oItem.open = !oItem.open;
			this._model().refresh(true);
		},

		onRemoveItem: function (oEvent) {
			var oItem = this._itemOf(oEvent.getSource());
			var oClaim = this._model().getProperty("/claim");
			delete this._mPendingChanges["item:" + oItem.ID];
			this._queueWrite(function () {
				return ExpenseService.removeItem(oItem.ID);
			}).then(function () {
				oClaim.items.splice(oClaim.items.indexOf(oItem), 1);
				this._decorate();
			}.bind(this)).catch(this._showError.bind(this));
		},

		onIssueFix: function (oEvent) {
			var oIssue = oEvent.getSource().getBindingContext("ex").getObject();
			var sItemPath = oEvent.getSource().getBindingContext("ex").getPath().replace(/\/issues\/\d+$/, "");
			var oItem = this._model().getProperty(sItemPath);

			if (oIssue.fix === "attach") {
				this._pickFiles(false, function (aFiles) {
					this._attachReceipt(oItem, aFiles[0]);
				}.bind(this));
			} else if (oIssue.fix === "use-detected") {
				oItem.expenseType_code = oItem.detectedType;
				this._changed("item", oItem.ID, { expenseType_code: oItem.detectedType });
				this._decorate();
			} else {
				// "reason" and "edit": open the line to type in it
				oItem.open = true;
				this._model().refresh(true);
			}
		},

		onIssueDismiss: function (oEvent) {
			var oIssue = oEvent.getSource().getBindingContext("ex").getObject();
			var sItemPath = oEvent.getSource().getBindingContext("ex").getPath().replace(/\/issues\/\d+$/, "");
			var oItem = this._model().getProperty(sItemPath);
			oItem.dismissed.push(oIssue.key);
			this._decorate();
		},

		onShowNextIssue: function () {
			var sFirst = this._oReadiness && this._oReadiness.firstToFix;
			var oClaim = this._model().getProperty("/claim");
			this._viewModel().setProperty("/showErrors", true);
			var oItem = oClaim.items.find(function (oCandidate) {
				return oCandidate.ID === sFirst;
			});
			if (oItem) {
				oItem.open = true;
			}
			this._decorate();
		},

		/* ═════════════ Receipts ═════════════ */

		/**
		 * Asks for files with the browser's own picker.
		 * @param {boolean} bMultiple more than one file
		 * @param {function} fnPicked called with the files
		 * @param {boolean} [bCamera] take a photo with the camera instead (phones)
		 */
		_pickFiles: function (bMultiple, fnPicked, bCamera) {
			var oInput = document.createElement("input");
			oInput.type = "file";
			oInput.multiple = bMultiple;
			if (bCamera) {
				// A phone opens its camera (the back one) instead of the file picker
				oInput.accept = "image/*";
				oInput.setAttribute("capture", "environment");
			} else {
				oInput.accept = "image/*,application/pdf";
			}
			oInput.addEventListener("change", function () {
				if (oInput.files.length) {
					fnPicked(Array.prototype.slice.call(oInput.files));
				}
			});
			oInput.click();
		},

		onPickReceipts: function () {
			this._pickFiles(true, this._readReceipts.bind(this));
		},

		/** Lines or Grid: how the claim's items are shown */
		onItemModePress: function (oEvent) {
			this._viewModel().setProperty("/itemMode", oEvent.getSource().data("mode"));
		},

		/** Screenshots from a banking app: each becomes a line, flagged as not a VAT receipt. */
		onPickScreenshots: function () {
			this._pickFiles(true, function (aFiles) {
				var aImages = aFiles.filter(function (oFile) {
					return /^image\//.test(oFile.type);
				});
				if (aImages.length) {
					this._readReceipts(aImages, true);
				}
			}.bind(this));
		},

		onAttachReceipt: function (oEvent) {
			var oItem = this._itemOf(oEvent.getSource());
			this._pickFiles(false, function (aFiles) {
				this._attachReceipt(oItem, aFiles[0]);
			}.bind(this));
		},

		_attachReceipt: function (oItem, oFile) {
			// A real receipt replaces a banking screenshot: the line stops saying so
			var bWasScreenshot = ExpenseClaims.isFromScreenshot(oItem);
			var sNotes = bWasScreenshot
				? oItem.notes.slice(ExpenseClaims.SCREENSHOT_NOTE.length).replace(/^ · /, "") || null : oItem.notes;
			this._viewModel().setProperty("/savedText", this._text("exSaving"));
			this._queueWrite(function () {
				return ExpenseService.putReceipt(oItem.ID, oFile, oFile.name).then(function () {
					return bWasScreenshot ? ExpenseService.updateItem(oItem.ID, { notes: sNotes }) : null;
				});
			}).then(function () {
				oItem.notes = sNotes;
				oItem.receiptAttached = true;
				oItem.receiptFileName = oFile.name;
				this._viewModel().setProperty("/savedText", this._text("exSaved"));
				this._decorate();
			}.bind(this)).catch(this._showError.bind(this));
		},

		onOpenReceipt: function (oEvent) {
			var oItem = this._itemOf(oEvent.getSource());
			window.open(ExpenseService.myReceiptUrl(oItem.ID, oItem.IsActiveEntity !== false), "_blank");
		},

		/** Wires the drop zone up once it is on the page. */
		onDropRendered: function () {
			var oZone = this.byId("receiptDrop").getDomRef();
			var oDrop = oZone && oZone.querySelector("[data-drop]");
			if (!oDrop || oDrop.dataset.wired) {
				return;
			}
			oDrop.dataset.wired = "yes";
			oDrop.addEventListener("dragover", function (oEvent) {
				oEvent.preventDefault();
				oDrop.classList.add("hrxExDropOver");
			});
			oDrop.addEventListener("dragleave", function () {
				oDrop.classList.remove("hrxExDropOver");
			});
			oDrop.addEventListener("drop", function (oEvent) {
				oEvent.preventDefault();
				oDrop.classList.remove("hrxExDropOver");
				var aFiles = Array.prototype.slice.call(oEvent.dataTransfer.files).filter(function (oFile) {
					return /^image\//.test(oFile.type) || oFile.type === "application/pdf";
				});
				if (aFiles.length) {
					this._readReceipts(aFiles);
				}
			}.bind(this));
			oDrop.addEventListener("click", this.onPickReceipts.bind(this));
		},

		/**
		 * Each receipt becomes a line: a "Reading…" row while the AI reads it, then the
		 * date, amount (converted to the claim's currency), type and destination it
		 * found, with the receipt attached. The employee adds the reason.
		 * @param {File[]} aFiles the receipts
		 * @param {boolean} [bScreenshot] screenshots from a banking app rather than receipts
		 */
		_readReceipts: function (aFiles, bScreenshot) {
			var oClaim = this._model().getProperty("/claim");

			aFiles.forEach(function (oFile) {
				var oPlaceholder = { ID: "reading-" + Math.random(), reading: true, receiptFileName: oFile.name, issues: [], okChecks: [], dismissed: [] };
				oClaim.items.push(oPlaceholder);
				this._decorate();

				fileForReading(oFile).then(function (oPrepared) {
					return ExpenseService.readReceipt(oPrepared.base64, oPrepared.mimeType, oClaim.country);
				}).then(function (oReading) {
					// An itemised receipt becomes one line per printed line
					var aLines = ExpenseClaims.linesFromReading(oReading, oClaim.currency, bScreenshot);
					return this._queueWrite(function () {
						return this._createReadLines(oClaim, aLines, oFile);
					}.bind(this));
				}.bind(this)).then(function (aItems) {
					aItems.forEach(function (oItem) {
						oItem.open = false;
						oItem.dismissed = [];
					});
					// The new lines take the "Reading…" row's place
					Array.prototype.splice.apply(oClaim.items, [oClaim.items.indexOf(oPlaceholder), 1].concat(aItems));
					this._decorate();
				}.bind(this)).catch(function (oError) {
					oClaim.items.splice(oClaim.items.indexOf(oPlaceholder), 1);
					this._decorate();
					MessageBox.warning(this._text("exReadError", [oFile.name, oError.message]));
				}.bind(this));
			}.bind(this));
		},

		/**
		 * Creates the lines read from one receipt. Where it can, the photo goes up once,
		 * onto the first line, and the service copies it to the others (shareReceipt),
		 * so a phone on a slow connection uploads it only once. shareReceipt copies it
		 * to every line of the claim without a receipt, so when another line is still
		 * waiting for its own receipt, each new line gets the photo uploaded instead.
		 * @param {object} oClaim the draft claim
		 * @param {object[]} aLines from ExpenseClaims.linesFromReading
		 * @param {File} oFile the receipt
		 * @returns {Promise<object[]>} the created items
		 */
		_createReadLines: function (oClaim, aLines, oFile) {
			var aItems = [];
			var pCreated = Promise.resolve();
			aLines.forEach(function (oLine) {
				var oItem = Object.assign({}, oLine);
				delete oItem.scanConfidence;
				delete oItem.detectedType;
				pCreated = pCreated.then(function () {
					return ExpenseService.addItem(oClaim.ID, oItem);
				}).then(function (oCreated) {
					oCreated.scanConfidence = oLine.scanConfidence;
					oCreated.detectedType = oLine.detectedType;
					aItems.push(oCreated);
				});
			});
			var bOthersWithout = oClaim.items.some(function (oOther) {
				return !oOther.reading && !oOther.receiptAttached;
			});
			return pCreated.then(function () {
				if (aItems.length > 1 && !bOthersWithout) {
					return ExpenseService.putReceipt(aItems[0].ID, oFile, oFile.name).then(function () {
						return ExpenseService.shareReceipt(oClaim.ID, aItems[0].ID);
					});
				}
				return aItems.reduce(function (pUpload, oItem) {
					return pUpload.then(function () {
						return ExpenseService.putReceipt(oItem.ID, oFile, oFile.name);
					});
				}, Promise.resolve());
			}).then(function () {
				aItems.forEach(function (oItem) {
					oItem.receiptAttached = true;
					oItem.receiptFileName = oFile.name;
				});
				return aItems;
			});
		},

		/* ═════════════ Mileage ═════════════ */

		onAddMileage: function () {
			var oClaim = this._model().getProperty("/claim");
			var oPolicy = this._mPolicies[oClaim.country] || {};
			this._queueWrite(function () {
				return ExpenseService.addMileage(oClaim.ID, {
					tripDate: ExpenseClaims.todayIso(),
					engineType: "Petrol",
					ratePerMile: Number(oPolicy.mileageRate) || 0.25
				});
			}).then(function (oMileage) {
				oClaim.mileageClaims.push(oMileage);
				this._decorate();
			}.bind(this)).catch(this._showError.bind(this));
		},

		onMileageFieldChange: function (oEvent) {
			var oControl = oEvent.getSource();
			var oMileage = oControl.getBindingContext("ex").getObject();
			var sField = oControl.data("field");
			var vValue = this._fieldValue(oControl);
			if (sField === "milesCount") {
				vValue = this._numberOrNull(vValue);
			}
			oMileage[sField] = vValue;

			var oChanges = {};
			oChanges[sField] = vValue;
			this._changed("mileage", oMileage.ID, oChanges);
			this._decorate();
		},

		onRemoveMileage: function (oEvent) {
			var oMileage = oEvent.getSource().getBindingContext("ex").getObject();
			var oClaim = this._model().getProperty("/claim");
			delete this._mPendingChanges["mileage:" + oMileage.ID];
			this._queueWrite(function () {
				return ExpenseService.removeMileage(oMileage.ID);
			}).then(function () {
				oClaim.mileageClaims.splice(oClaim.mileageClaims.indexOf(oMileage), 1);
				this._decorate();
			}.bind(this)).catch(this._showError.bind(this));
		},

		/* ═════════════ Applying for approval ═════════════ */

		onApply: function () {
			var oClaim = this._model().getProperty("/claim");
			this._viewModel().setProperty("/showErrors", true);
			this._decorate();

			if (this._oReadiness.reading) {
				MessageToast.show(this._text("exStillReading"));
				return;
			}
			if (this._oReadiness.empty) {
				MessageBox.warning(this._text("exApplyEmpty"));
				return;
			}
			if (this._oReadiness.toFix) {
				MessageBox.warning(this._text("exApplyFixFirst", [this._oReadiness.toFix]));
				this.onShowNextIssue();
				return;
			}

			ExpenseService.approverFor(oClaim.country).catch(function () {
				return "";
			}).then(function (sApprover) {
				MessageBox.confirm(sApprover ? this._text("exApplyConfirm", [sApprover]) : this._text("exApplyConfirmNoName"), {
					title: this._text("exApply"),
					actions: [this._text("exApplySend"), MessageBox.Action.CANCEL],
					emphasizedAction: this._text("exApplySend"),
					onClose: function (sAction) {
						if (sAction === this._text("exApplySend")) {
							this._submit(oClaim);
						}
					}.bind(this)
				});
			}.bind(this));
		},

		_submit: function (oClaim) {
			var oViewModel = this._viewModel();
			oViewModel.setProperty("/busy", true);
			this._flushChanges().then(function () {
				return ExpenseService.saveClaim(oClaim.ID);
			}).then(function () {
				return ExpenseService.submitClaim(oClaim.ID);
			}).then(function (oSubmitted) {
				MessageToast.show(this._text("exSubmitted", [oSubmitted.claimNumber || ""]));
				this._backToList();
			}.bind(this)).catch(function (oError) {
				// The claim was saved but not sent: reopen it as a draft to fix it
				this._showError(oError);
				return ExpenseService.editClaim(oClaim.ID).then(function () {
					return ExpenseService.claim(oClaim.ID, false);
				}).then(function (oDraft) {
					this._showClaim(oDraft, false, false);
					this._viewModel().setProperty("/showErrors", true);
				}.bind(this)).catch(function () {
					this._backToList();
				}.bind(this));
			}.bind(this)).finally(function () {
				oViewModel.setProperty("/busy", false);
			});
		},

		_showError: function (oError) {
			MessageBox.error(oError && oError.message ? oError.message : String(oError));
		}
	});
});
