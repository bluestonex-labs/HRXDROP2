sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Fragment",
	"sap/ui/core/format/DateFormat",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"../model/ExpenseService",
	"../model/ExpenseClaims"
], function (Controller, Fragment, DateFormat, JSONModel, MessageBox, MessageToast, ExpenseService, ExpenseClaims) {
	"use strict";

	var oDisplayDate = DateFormat.getDateInstance({ pattern: "d MMM yyyy" });
	var oDisplayDateTime = DateFormat.getDateTimeInstance({ pattern: "d MMM yyyy, HH:mm" });
	var oIsoDate = DateFormat.getDateInstance({ pattern: "yyyy-MM-dd" });
	var oMonth = DateFormat.getDateInstance({ pattern: "MMMM yyyy" });

	var COUNTRY_NAMES = { UK: "United Kingdom", IN: "India" };

	// While the launchpad is still updating after a deploy, the page loads again this often
	var UPDATING_RETRY_MS = 20000;

	function displayDate(sIso) {
		var oDate = sIso ? oIsoDate.parse(String(sIso).slice(0, 10)) : null;
		return oDate ? oDisplayDate.format(oDate) : "";
	}

	function displayDateTime(sTimestamp) {
		return sTimestamp ? oDisplayDateTime.format(new Date(sTimestamp)) : "";
	}

	function isoDaysAgo(iDays) {
		var oDate = new Date();
		oDate.setDate(oDate.getDate() - iDays);
		return oIsoDate.format(oDate);
	}

	/** Saves a file the browser has in memory, e.g. a PDF from the service. */
	function saveFile(oBlob, sFileName) {
		var oLink = document.createElement("a");
		oLink.href = URL.createObjectURL(oBlob);
		oLink.download = sFileName;
		document.body.appendChild(oLink);
		oLink.click();
		document.body.removeChild(oLink);
		URL.revokeObjectURL(oLink.href);
	}

	/*
	 * Expense approvals: claims waiting for the user's decision (approve, or return to
	 * the employee with a reason), the expense dashboard, the history of every submitted
	 * claim, and, for an expense Admin, the policy and approvers per country. What a user
	 * sees follows their expense role in BTP (Approver, Admin); the service enforces it.
	 */
	return Controller.extend("bsx.hrx.hrx2026.controller.ExpenseApprovals", {

		onInit: function () {
			this.getView().setModel(new JSONModel({
				busy: false,
				reviewBusy: false,
				error: "",
				checked: false,
				canApprove: false,
				canAdminister: false,
				tab: "awaiting",
				comment: "",
				dash: { from: isoDaysAgo(90), to: ExpenseClaims.todayIso(), country: "UK" },
				hist: { from: "", to: "", status: "All", country: "ALL", query: "" },
				historyStatuses: [{ key: "All", text: this._text("exStatusAll") }].concat(
					["Submitted", "FirstApproved", "Approved", "Returned", "Rejected"].map(function (sKey) {
						return { key: sKey, text: ExpenseClaims.STATUS[sKey].text };
					}))
			}), "eaView");
			this.getView().setModel(new JSONModel({
				awaiting: [],
				awaitingMine: 0,
				history: [],
				historyRows: [],
				historyHint: "",
				dash: { categories: [], claimants: [], trend: [] },
				policies: [],
				approvers: [],
				employees: [],
				audit: [],
				review: null,
				journey: null
			}), "ea");

			this._mTypes = {};
			this._aTaxTypes = [];
			this.getOwnerComponent().getRouter().getRoute("expenseapprovals").attachPatternMatched(this._onRouteMatched, this);

			// Download PDF sits in the top bar on the tabs that list claims, as Expenses'
			// Refresh and Create do
			this._viewModel().bindProperty("/tab").attachChange(this._publishTopBar, this);
			this._viewModel().bindProperty("/canApprove").attachChange(this._publishTopBar, this);
			this._viewModel().bindProperty("/canAdminister").attachChange(this._publishTopBar, this);
		},

		/** The top bar for the tab on screen: Download PDF on Awaiting decision and History. */
		_publishTopBar: function () {
			var oViewModel = this._viewModel();
			var sTab = oViewModel.getProperty("/tab");
			var bAllowed = oViewModel.getProperty("/canApprove") || oViewModel.getProperty("/canAdminister");
			var aButtons = bAllowed && (sTab === "awaiting" || sTab === "history")
				? [{ key: "pdf", text: this._text("eaDownloadPdf"), icon: "sap-icon://pdf-attachment", primary: false }] : [];
			var oApp = this.getOwnerComponent().getRootControl().getController();
			if (oApp && oApp.setTopBar) {
				oApp.setTopBar("expenseapprovals", { stamp: "", buttons: aButtons });
			}
		},

		/**
		 * A press on one of this page's top bar buttons (App.controller onTopBarButton).
		 * @param {string} sKey pdf
		 */
		onTopBarButton: function (sKey) {
			if (sKey === "pdf") {
				this.onDownloadPdf();
			}
		},

		_text: function (sKey, aArgs) {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(sKey, aArgs);
		},

		_model: function () {
			return this.getView().getModel("ea");
		},

		_viewModel: function () {
			return this.getView().getModel("eaView");
		},

		_onRouteMatched: function () {
			var oViewModel = this._viewModel();
			// The shell has just cleared the top bar for the new route
			this._publishTopBar();
			oViewModel.setProperty("/busy", true);
			oViewModel.setProperty("/error", "");

			Promise.all([ExpenseService.canApprove(), ExpenseService.canAdminister(), ExpenseService.lookups()]).then(function (aAnswers) {
				oViewModel.setProperty("/canApprove", aAnswers[0]);
				oViewModel.setProperty("/canAdminister", aAnswers[1]);
				oViewModel.setProperty("/checked", true);
				aAnswers[2].types.forEach(function (oType) {
					this._mTypes[oType.code] = oType;
				}.bind(this));
				this._aTaxTypes = aAnswers[2].taxTypes;
				// Start on a tab the user can use
				if (!aAnswers[0] && oViewModel.getProperty("/tab") === "awaiting") {
					oViewModel.setProperty("/tab", "dashboard");
				}
				return this._loadTab();
			}.bind(this)).catch(this._showLoadError.bind(this)).finally(function () {
				oViewModel.setProperty("/busy", false);
			});
		},

		onTabPress: function (oEvent) {
			this._viewModel().setProperty("/tab", oEvent.getSource().data("tab"));
			this._viewModel().setProperty("/busy", true);
			this._loadTab().catch(this._showLoadError.bind(this)).finally(function () {
				this._viewModel().setProperty("/busy", false);
			}.bind(this));
		},

		_loadTab: function () {
			var oViewModel = this._viewModel();
			if (!oViewModel.getProperty("/canApprove") && !oViewModel.getProperty("/canAdminister")) {
				return Promise.resolve();
			}
			switch (oViewModel.getProperty("/tab")) {
				case "awaiting": return this._loadAwaiting();
				case "dashboard": return this._loadDashboard();
				case "history": return this._loadHistory();
				case "settings": return this._loadSettings();
				default: return Promise.resolve();
			}
		},

		_showLoadError: function (oError) {
			if (oError.status === 503) {
				// Just deployed: the launchpad is still updating its routes. Say so, and
				// load again shortly without the user having to.
				this._viewModel().setProperty("/error", this._text("exUpdating"));
				clearTimeout(this._iReloadTimer);
				this._iReloadTimer = setTimeout(this._onRouteMatched.bind(this), UPDATING_RETRY_MS);
				return;
			}
			this._viewModel().setProperty("/error", this._text("exLoadError", [oError.message]));
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

		/* ═════════════ Awaiting decision ═════════════ */

		_loadAwaiting: function () {
			return ExpenseService.awaitingDecision().then(function (aClaims) {
				// The queue holds every claim waiting at any step. Each row says whose
				// decision it is, and the signed-in approver's own come first.
				var mSteps = {};
				aClaims.forEach(function (oClaim) {
					var iLevel = oClaim.status === "FirstApproved" ? 2 : 1;
					mSteps[oClaim.country + iLevel] = { country: oClaim.country, level: iLevel };
				});
				var aSteps = Object.keys(mSteps).map(function (sKey) {
					return mSteps[sKey];
				});
				return Promise.all([
					ExpenseService.approverWhoAmI(),
					Promise.all(aSteps.map(function (oStep) {
						return ExpenseService.approverName(oStep.country, oStep.level).catch(function () {
							return "";
						});
					}))
				]).then(function (aAnswers) {
					var sMe = (aAnswers[0] && aAnswers[0].fullName) || "";
					var mDecider = {};
					aSteps.forEach(function (oStep, iIndex) {
						mDecider[oStep.country + oStep.level] = aAnswers[1][iIndex];
					});
					return aClaims.map(function (oClaim) {
						var iLevel = oClaim.status === "FirstApproved" ? 2 : 1;
						var sDecider = mDecider[oClaim.country + iLevel] || "";
						var bMine = !!sDecider && sDecider === sMe;
						return { claim: oClaim, decider: sDecider, mine: bMine };
					});
				});
			}).then(function (aRows) {
				aRows.sort(function (oA, oB) {
					return Number(oB.mine) - Number(oA.mine);
				});
				this._model().setProperty("/awaitingMine", aRows.filter(function (oRow) {
					return oRow.mine;
				}).length);
				this._model().setProperty("/awaiting", aRows.map(function (oRow) {
					var oClaim = oRow.claim;
					// The service joins a claim's policy warnings with " • "
					var iFlags = oClaim.policyFlags ? oClaim.policyFlags.split(" • ").filter(Boolean).length : 0;
					return Object.assign({}, oClaim, {
						employeeName: oClaim.employeeName || oClaim.createdBy,
						countryName: COUNTRY_NAMES[oClaim.country] || oClaim.country,
						submittedText: displayDateTime(oClaim.submittedAt),
						statusText: oClaim.status === "FirstApproved" ? this._text("eaSecondLevel") : this._text("eaFirstLevel"),
						deciderText: oRow.mine ? this._text("eaDeciderYou") : oRow.decider || this._text("eaDeciderNone"),
						mine: oRow.mine,
						totalText: ExpenseClaims.money(oClaim.totalGross, oClaim.currency),
						flagsText: iFlags ? this._text(iFlags === 1 ? "eaOneFlag" : "eaFlags", [iFlags]) : ""
					});
				}.bind(this)));
			}.bind(this));
		},

		onReview: function (oEvent) {
			var oRow = oEvent.getSource().getBindingContext("ea").getObject();
			var oViewModel = this._viewModel();
			oViewModel.setProperty("/comment", "");
			oViewModel.setProperty("/reviewBusy", true);

			this._openDialog("_pReviewDialog", "bsx.hrx.hrx2026.fragment.ExpenseReviewDialog").then(function (oDialog) {
				oDialog.open();
				return ExpenseService.approvalClaim(oRow.ID);
			}).then(function (oClaim) {
				var oReview = this._reviewModel(oClaim);
				// Only the approver for this step can decide; anyone else may look
				oReview.mine = oRow.mine;
				oReview.deciderText = oRow.deciderText;
				this._model().setProperty("/review", oReview);
			}.bind(this)).catch(function (oError) {
				MessageBox.error(oError.message);
			}).finally(function () {
				oViewModel.setProperty("/reviewBusy", false);
			});
		},

		/** @returns {object} what the review dialog shows of a claim */
		_reviewModel: function (oClaim) {
			var fnTaxRate = this._taxRateFor(oClaim.country);
			var oTotals = ExpenseClaims.claimTotals(oClaim, fnTaxRate);
			var sTaxName = this._text(oClaim.country === "IN" ? "exGst" : "exVat");
			return {
				ID: oClaim.ID,
				claimNumber: oClaim.claimNumber,
				country: oClaim.country,
				status: oClaim.status,
				employeeName: oClaim.employeeName || oClaim.createdBy,
				employeeNumber: oClaim.employeeNumber,
				periodText: displayDate(oClaim.claimPeriod),
				stageText: oClaim.status === "FirstApproved" ? this._text("eaSecondLevel") : this._text("eaFirstLevel"),
				totalText: ExpenseClaims.money(oClaim.totalGross, oClaim.currency),
				totalSub: this._text("exTotalSub", [ExpenseClaims.money(oClaim.totalNet, oClaim.currency), sTaxName, ExpenseClaims.money(oClaim.totalVAT, oClaim.currency)]),
				flagsText: oClaim.policyFlags ? this._text("eaFlagsBanner", [oClaim.policyFlags]) : "",
				items: oClaim.items.map(function (oItem) {
					var bForeign = !!oItem.originalCurrency && oItem.originalCurrency !== oClaim.currency;
					return Object.assign({}, oItem, {
						dateText: displayDate(oItem.expenseDate),
						typeText: (this._mTypes[oItem.expenseType_code] || {}).description || oItem.expenseType_code,
						netText: ExpenseClaims.money(oItem.netAmount, oClaim.currency),
						taxText: ExpenseClaims.money(oItem.vatAmount, oClaim.currency),
						grossText: ExpenseClaims.money(oItem.grossAmount, oClaim.currency),
						fxText: bForeign && oItem.originalAmount ? ExpenseClaims.money(oItem.originalAmount, oItem.originalCurrency) : ""
					});
				}.bind(this)),
				mileageClaims: oClaim.mileageClaims.map(function (oMileage) {
					return Object.assign({}, oMileage, {
						dateText: displayDate(oMileage.tripDate),
						milesText: String(Number(oMileage.milesCount) || 0),
						amountText: ExpenseClaims.money(oMileage.totalAmount, oClaim.currency)
					});
				})
			};
		},

		onOpenReviewReceipt: function (oEvent) {
			var oItem = oEvent.getSource().getBindingContext("ea").getObject();
			window.open(ExpenseService.approvalReceiptUrl(oItem.ID), "_blank");
		},

		onApprove: function () {
			var oReview = this._model().getProperty("/review");
			// A UK claim's first approval sends it on to the second approver
			var bToSecond = oReview.country === "UK" && oReview.status === "Submitted";
			this._decide(ExpenseService.approve(oReview.ID, this._viewModel().getProperty("/comment")), bToSecond ? "eaApprovedToSecond" : "eaApproved", oReview);
		},

		onReturn: function () {
			var oReview = this._model().getProperty("/review");
			var sReason = (this._viewModel().getProperty("/comment") || "").trim();
			if (!sReason) {
				MessageBox.warning(this._text("eaReasonNeeded"));
				return;
			}
			this._decide(ExpenseService.returnClaim(oReview.ID, sReason), "eaReturned", oReview);
		},

		_decide: function (pDecision, sDoneKey, oReview) {
			var oViewModel = this._viewModel();
			oViewModel.setProperty("/reviewBusy", true);
			pDecision.then(function () {
				MessageToast.show(this._text(sDoneKey, [oReview.claimNumber]));
				this.onCloseReview();
				return this._loadAwaiting();
			}.bind(this)).catch(function (oError) {
				MessageBox.error(oError.message);
			}).finally(function () {
				oViewModel.setProperty("/reviewBusy", false);
			});
		},

		onCloseReview: function () {
			this.byId("expenseReviewDialog").close();
			this._model().setProperty("/review", null);
		},

		/* ═════════════ Dashboard ═════════════ */

		onDashboardChange: function () {
			this._viewModel().setProperty("/busy", true);
			this._loadDashboard().catch(this._showLoadError.bind(this)).finally(function () {
				this._viewModel().setProperty("/busy", false);
			}.bind(this));
		},

		_loadDashboard: function () {
			var oDash = this._viewModel().getProperty("/dash");

			/**
			 * An amount row as text: in the country's currency, or with both countries
			 * in both currencies (pounds and rupees can't be added together).
			 * @param {object} oRow a row with gbp and inr
			 * @returns {string} e.g. "£120.00" or "£120.00 · ₹4,000.00"
			 */
			var fnAmountText = function (oRow) {
				if (oDash.country === "UK") {
					return ExpenseClaims.money(oRow.gbp, "GBP");
				}
				if (oDash.country === "IN") {
					return ExpenseClaims.money(oRow.inr, "INR");
				}
				return [
					Number(oRow.gbp) ? ExpenseClaims.money(oRow.gbp, "GBP") : "",
					Number(oRow.inr) ? ExpenseClaims.money(oRow.inr, "INR") : ""
				].filter(Boolean).join(" · ");
			};

			return ExpenseService.dashboard(oDash.from, oDash.to, oDash.country).then(function (oStats) {
				var fnCount = function (oCount) {
					if (!oCount) {
						return 0;
					}
					return (oDash.country === "ALL" ? oCount.total : oCount[oDash.country]) || 0;
				};
				// Bars are drawn against the largest amount in each currency
				var fnBars = function (aRows, fnName) {
					var aWithAmount = (aRows || []).filter(function (oRow) {
						return (oDash.country !== "IN" && Number(oRow.gbp) > 0) || (oDash.country !== "UK" && Number(oRow.inr) > 0);
					});
					var fMaxGbp = Math.max.apply(null, [1].concat(aWithAmount.map(function (oRow) { return Number(oRow.gbp) || 0; })));
					var fMaxInr = Math.max.apply(null, [1].concat(aWithAmount.map(function (oRow) { return Number(oRow.inr) || 0; })));
					return aWithAmount.map(function (oRow) {
						var fShareGbp = oDash.country === "IN" ? 0 : (Number(oRow.gbp) || 0) / fMaxGbp;
						var fShareInr = oDash.country === "UK" ? 0 : (Number(oRow.inr) || 0) / fMaxInr;
						return {
							name: fnName(oRow),
							amountText: fnAmountText(oRow),
							percent: Math.round(Math.max(fShareGbp, fShareInr) * 100)
						};
					});
				};
				var oReimbursed = (oStats.spendByCategory || []).reduce(function (oSum, oRow) {
					return { gbp: oSum.gbp + (Number(oRow.gbp) || 0), inr: oSum.inr + (Number(oRow.inr) || 0) };
				}, { gbp: 0, inr: 0 });
				var oViolation = oStats.violation || { rate: 0, flagged: 0, total: 0 };

				this._model().setProperty("/dash", {
					awaiting: fnCount(oStats.awaiting),
					approved: fnCount(oStats.approved),
					returned: fnCount(oStats.rejected),
					reimbursedText: this._text("eaReimbursed", [fnAmountText(oReimbursed) || ExpenseClaims.money(0, oDash.country === "IN" ? "INR" : "GBP")]),
					violationRate: Number(oViolation.rate) || 0,
					violationText: (Number(oViolation.rate) || 0) + "%",
					violationSub: this._text("eaViolationSub", [oViolation.flagged || 0, oViolation.total || 0]),
					categories: fnBars(oStats.spendByCategory, function (oRow) { return oRow.description || oRow.code; }),
					claimants: fnBars(oStats.topClaimants, function (oRow) { return oRow.name; }),
					trend: (oStats.trend || []).map(function (oRow) {
						var oFirst = new Date(oRow.month + "-01T00:00:00");
						return Object.assign({}, oRow, { monthText: isNaN(oFirst) ? oRow.month : oMonth.format(oFirst) });
					})
				});
			}.bind(this));
		},

		/* ═════════════ History ═════════════ */

		_loadHistory: function () {
			return ExpenseService.history().then(function (aClaims) {
				this._model().setProperty("/history", aClaims.map(function (oClaim) {
					var oStatus = ExpenseClaims.statusOf(oClaim.status);
					return Object.assign({}, oClaim, {
						employeeName: oClaim.employeeName || oClaim.createdBy,
						countryName: COUNTRY_NAMES[oClaim.country] || oClaim.country,
						submittedText: displayDateTime(oClaim.submittedAt),
						statusText: oStatus.text,
						statusState: oStatus.state,
						totalText: ExpenseClaims.money(oClaim.totalGross, oClaim.currency)
					});
				}.bind(this)));
				this.onHistoryFilter();
			}.bind(this));
		},

		onHistoryFilter: function () {
			var oFilters = this._viewModel().getProperty("/hist");
			var sQuery = (oFilters.query || "").trim().toLowerCase();
			var aRows = this._model().getProperty("/history").filter(function (oClaim) {
				var sSubmitted = String(oClaim.submittedAt || "").slice(0, 10);
				var sText = [oClaim.claimNumber, oClaim.employeeName, oClaim.employeeNumber, oClaim.statusText].join(" ").toLowerCase();
				return (oFilters.status === "All" || oClaim.status === oFilters.status) &&
					(oFilters.country === "ALL" || oClaim.country === oFilters.country) &&
					(!oFilters.from || sSubmitted >= oFilters.from) &&
					(!oFilters.to || sSubmitted <= oFilters.to) &&
					(!sQuery || sText.indexOf(sQuery) >= 0);
			});
			this._model().setProperty("/historyRows", aRows);
			this._model().setProperty("/historyHint", this._text(aRows.length === 1 ? "exOneClaim" : "exClaims", [aRows.length]));
		},

		onOpenJourney: function (oEvent) {
			var oClaim = oEvent.getParameter("listItem").getBindingContext("ea").getObject();
			ExpenseService.claimJourney(oClaim.claimNumber).then(function (oJourney) {
				oJourney.totalText = ExpenseClaims.money(oJourney.totalGross, oJourney.currency);
				// No HRX name for the claimant: show the login they claimed with
				oJourney.employeeName = oJourney.employeeName || oClaim.employeeName;
				oJourney.events = (oJourney.events || []).map(function (oStep) {
					return Object.assign({}, oStep, { byText: oStep.by || "", atText: displayDateTime(oStep.at) });
				});
				oJourney.attachments = (oJourney.attachments || []).map(function (oAttachment) {
					return Object.assign({}, oAttachment, { grossText: ExpenseClaims.money(oAttachment.gross, oJourney.currency) });
				});
				this._model().setProperty("/journey", oJourney);
				return this._openDialog("_pJourneyDialog", "bsx.hrx.hrx2026.fragment.ExpenseJourneyDialog");
			}.bind(this)).then(function (oDialog) {
				oDialog.open();
			}).catch(function (oError) {
				MessageBox.error(oError.message);
			});
		},

		onOpenJourneyReceipt: function (oEvent) {
			var oAttachment = oEvent.getSource().getBindingContext("ea").getObject();
			window.open(ExpenseService.approvalReceiptUrl(oAttachment.itemID), "_blank");
		},

		onCloseJourney: function () {
			this.byId("expenseJourneyDialog").close();
		},

		onDownloadPdf: function () {
			var oViewModel = this._viewModel();
			var bHistory = oViewModel.getProperty("/tab") === "history";
			var oFilters = oViewModel.getProperty("/hist");
			oViewModel.setProperty("/busy", true);
			ExpenseService.claimsPdf(bHistory ? {
				scope: "history",
				status: oFilters.status === "All" ? null : oFilters.status,
				country: oFilters.country === "ALL" ? null : oFilters.country,
				claimNo: oFilters.query || null,
				fromDate: oFilters.from || null,
				toDate: oFilters.to || null
			} : { scope: "approvals" }).then(function (oPdf) {
				saveFile(oPdf, bHistory ? "expense-claim-history.pdf" : "expense-approvals.pdf");
			}).catch(function (oError) {
				MessageBox.error(oError.message);
			}).finally(function () {
				oViewModel.setProperty("/busy", false);
			});
		},

		/* ═════════════ Settings ═════════════ */

		_loadSettings: function () {
			return Promise.all([ExpenseService.policies(), ExpenseService.approvers(), ExpenseService.employees(), ExpenseService.auditLog()]).then(function (aAnswers) {
				this._model().setProperty("/audit", aAnswers[3].map(function (oEntry) {
					return Object.assign({}, oEntry, { whenText: displayDateTime(oEntry.timestamp) });
				}));
				this._model().setProperty("/policies", aAnswers[0].map(function (oPolicy) {
					return Object.assign({}, oPolicy, {
						countryName: COUNTRY_NAMES[oPolicy.country] || oPolicy.country,
						currency: ExpenseClaims.CURRENCY_OF_COUNTRY[oPolicy.country]
					});
				}));
				var aEmployees = aAnswers[2].filter(function (oEmployee) {
					return oEmployee.email && oEmployee.IsActive !== "N";
				}).map(function (oEmployee) {
					return { email: oEmployee.email, label: oEmployee.fullName + " (" + oEmployee.email + ")" };
				});
				var mByEmail = {};
				aEmployees.forEach(function (oEmployee) {
					mByEmail[oEmployee.email.toLowerCase()] = oEmployee;
				});
				// Each approver set today shows in its box, even when HRX spells the email
				// differently or no longer lists the person; otherwise the box looks empty
				// although an approver is set
				var fnShown = function (sEmail) {
					if (!sEmail) {
						return sEmail;
					}
					var oKnown = mByEmail[sEmail.toLowerCase()];
					if (oKnown) {
						return oKnown.email;
					}
					var oExtra = { email: sEmail, label: sEmail };
					aEmployees.push(oExtra);
					mByEmail[sEmail.toLowerCase()] = oExtra;
					return sEmail;
				};
				this._model().setProperty("/approvers", aAnswers[1].map(function (oRow) {
					return Object.assign({}, oRow, {
						countryName: COUNTRY_NAMES[oRow.country] || oRow.country,
						firstApprover: fnShown(oRow.firstApprover),
						secondApprover: fnShown(oRow.secondApprover)
					});
				}));
				this._model().setProperty("/employees", aEmployees.sort(function (a, b) {
					return a.label.localeCompare(b.label);
				}));
			}.bind(this));
		},

		onSavePolicy: function (oEvent) {
			var oPolicy = oEvent.getSource().getBindingContext("ea").getObject();
			this._saveSetting("Policies", "ID=" + oPolicy.ID, {
				mileageRate: Number(oPolicy.mileageRate),
				hotelDailyLimit: Number(oPolicy.hotelDailyLimit),
				mealDailyLimit: Number(oPolicy.mealDailyLimit),
				claimNumberStart: oPolicy.claimNumberStart
			}, oPolicy.countryName);
		},

		onSaveApprovers: function (oEvent) {
			var oRow = oEvent.getSource().getBindingContext("ea").getObject();
			if (!oRow.firstApprover) {
				MessageBox.warning(this._text("eaFirstApproverNeeded"));
				return;
			}
			this._saveSetting("WorkflowMembers", "country='" + oRow.country + "'", {
				firstApprover: oRow.firstApprover,
				secondApprover: oRow.country === "UK" ? (oRow.secondApprover || null) : null
			}, oRow.countryName);
		},

		_saveSetting: function (sEntitySet, sKey, oChanges, sCountryName) {
			var oViewModel = this._viewModel();
			oViewModel.setProperty("/busy", true);
			ExpenseService.saveSetting(sEntitySet, sKey, oChanges).then(function () {
				MessageToast.show(this._text("eaSaved", [sCountryName]));
				return this._loadSettings();
			}.bind(this)).catch(function (oError) {
				MessageBox.error(oError.message);
			}).finally(function () {
				oViewModel.setProperty("/busy", false);
			});
		},

		/* ═════════════ Dialogs ═════════════ */

		_openDialog: function (sCacheKey, sFragmentName) {
			if (!this[sCacheKey]) {
				this[sCacheKey] = Fragment.load({
					id: this.getView().getId(),
					name: sFragmentName,
					controller: this
				}).then(function (oDialog) {
					this.getView().addDependent(oDialog);
					return oDialog;
				}.bind(this));
			}
			return this[sCacheKey];
		}
	});
});
