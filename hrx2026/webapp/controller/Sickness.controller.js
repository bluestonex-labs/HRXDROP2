sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Fragment",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"../model/Backend",
	"../model/CurrentUser",
	"../model/SicknessPolicy",
	"../model/SicknessService",
	"../model/formatter",
	"../model/Mail"
], function (Controller, Fragment, JSONModel, Filter, FilterOperator, MessageBox, MessageToast,
	Backend, CurrentUser, SicknessPolicy, SicknessService, formatter, Mail) {
	"use strict";

	var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

	var RESOURCE_FIELDS = ["EmpID", "FName", "LName", "Email", "IsActive", "Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

	return Controller.extend("bsx.hrx.hrx2026.controller.Sickness", {

		formatter: formatter,

		/* =========================================================== */
		/* lifecycle                                                   */
		/* =========================================================== */

		onInit: function () {
			var oYear = SicknessPolicy.fiscalYearOf(new Date());

			this.setModel(new JSONModel({
				busy: false,
				year: oYear,
				isCurrentYear: true,
				ruleText: this.getText("skRule", [SicknessPolicy.TRIGGER_INSTANCES]),
				alert: { text: "", type: "Information" },
				allExpanded: false,
				allCount: ""
			}), "skView");

			this.setModel(new JSONModel({ employees: [], absences: [], triggers: [], rtw: [] }), "sk");

			// Which trigger histories are open, so a reload after an action does not
			// fold away what the admin was looking at.
			this._mExpanded = {};
			this._iLoad = 0;

			this.getOwnerComponent().getRouter().getRoute("sickness")
				.attachPatternMatched(this._onRouteMatched, this);
		},

		/**
		 * The view is reused across navigations, so every entry reloads. Nothing is
		 * fetched for somebody without manager rights - the page shows them the
		 * restricted notice instead.
		 */
		_onRouteMatched: function () {
			CurrentUser.ready(this.getOwnerComponent()).then(function (oProfile) {
				this._oProfile = oProfile;
				this._sOrgId = oProfile.orgId;

				if (oProfile.isManager) {
					this._load();
				}
			}.bind(this));
		},

		/* =========================================================== */
		/* data loading                                                */
		/* =========================================================== */

		/**
		 * Loads the selected financial year's absences and trigger reviews, and every
		 * return to work still in progress.
		 * @returns {Promise} resolved once the page is filled in
		 */
		_load: function () {
			var oViewModel = this.getModel("skView");
			var oYear = oViewModel.getProperty("/year");
			var iLoad = ++this._iLoad;

			oViewModel.setProperty("/busy", true);

			return Promise.all([
				this._loadEmployees(),
				SicknessService.getAbsences(this._sOrgId, oYear.from, oYear.to),
				SicknessService.getTriggerReviews(this._sOrgId, oYear.startYear),
				SicknessService.getReturnsToWork(this._sOrgId)
			]).then(function (aResult) {
				// Stepping through the years quickly can land answers out of order; only
				// the latest request may fill the page.
				if (iLoad !== this._iLoad) {
					return;
				}
				this._build(aResult[1], aResult[2], aResult[3]);
			}.bind(this)).catch(function (oError) {
				if (iLoad === this._iLoad) {
					this._build([], [], []);
					this._showError("skErrorLoad", oError);
				}
			}.bind(this)).then(function () {
				if (iLoad === this._iLoad) {
					oViewModel.setProperty("/busy", false);
				}
			}.bind(this));
		},

		/**
		 * The organisation's people, for the employee picker and to fill in names and
		 * emails the sickness service leaves out. Loaded once: it does not change while
		 * the page is open. A failure is reported, but does not stop the rest of the
		 * page loading.
		 * @returns {Promise} resolved once the people are in the model
		 */
		_loadEmployees: function () {
			if (this._pEmployees) {
				return this._pEmployees;
			}

			this._pEmployees = Backend.read(this.getOwnerComponent().getModel(), "/Resources", {
				urlParameters: { "$select": RESOURCE_FIELDS.join(",") },
				filters: [new Filter("OrgID", FilterOperator.EQ, this._sOrgId)]
			}).then(function (oData) {
				var aPeople = ((oData && oData.results) || []).map(function (oResource) {
					delete oResource.__metadata;
					oResource.FullName = ((oResource.FName || "") + " " + (oResource.LName || "")).trim();
					return oResource;
				}).sort(function (a, b) {
					return a.FullName.localeCompare(b.FullName);
				});

				this._mPeople = {};
				aPeople.forEach(function (oPerson) {
					this._mPeople[oPerson.EmpID] = oPerson;
				}, this);

				this.getModel("sk").setProperty("/employees", aPeople.filter(function (oPerson) {
					return oPerson.IsActive === "Y";
				}));
			}.bind(this)).catch(function (oError) {
				// Let the next visit try again.
				this._pEmployees = null;
				this._mPeople = this._mPeople || {};
				this._showError("skErrorEmployees", oError);
			}.bind(this));

			return this._pEmployees;
		},

		/**
		 * Shapes the service's answers into what the page binds against.
		 * @param {Array<object>} aRawAbsences absences from the service
		 * @param {Array<object>} aReviews trigger reviews from the service
		 * @param {Array<object>} aRawRtw returns to work from the service
		 */
		_build: function (aRawAbsences, aReviews, aRawRtw) {
			var oViewModel = this.getModel("skView");
			var oModel = this.getModel("sk");
			var oYear = oViewModel.getProperty("/year");

			(oModel.getProperty("/triggers") || []).forEach(function (oTrigger) {
				this._mExpanded[oTrigger.EmpID] = !!oTrigger.expanded;
			}, this);

			var aAbsences = (aRawAbsences || []).map(this._toAbsence, this).filter(function (oAbsence) {
				return SicknessPolicy.inFiscalYear(oAbsence.StartDate, oYear);
			}).sort(function (a, b) {
				return b.StartDate.localeCompare(a.StartDate);
			});

			var aAllTriggers = SicknessPolicy.triggers(aAbsences, oYear, aReviews).map(this._toTrigger, this);
			var aRtw = (aRawRtw || []).map(this._toRtw, this);

			// Only open triggers stay in the list. A dismissed one moves to the All
			// sickness table, where the absences it covered carry the dismissal and
			// its reason - and a further absence brings it back as open.
			var aTriggers = aAllTriggers.filter(function (oTrigger) {
				return oTrigger.status === "OPEN";
			});
			var iOpen = aTriggers.length;
			var iDismissed = aAllTriggers.length - iOpen;

			aAllTriggers.forEach(function (oTrigger) {
				if (oTrigger.status !== "DISMISSED") {
					return;
				}
				oTrigger.absences.forEach(function (oAbsence, iIndex) {
					oAbsence.dismissed = true;
					oAbsence.dismissedTooltip = oTrigger.noteText;
					// The reason is written out once, on the newest absence it covered.
					oAbsence.dismissedNote = iIndex === 0 ? oTrigger.noteText : this.getText("skTriggerDismissed");
				}, this);
			}, this);

			oModel.setProperty("/absences", aAbsences);
			oModel.setProperty("/triggers", aTriggers);
			oViewModel.setProperty("/noTriggersText", this.getText(iDismissed ? "skNoOpenTriggers" : "skNoTriggers"));
			oModel.setProperty("/rtw", aRtw);

			oViewModel.setProperty("/allCount", this.getText(aAbsences.length === 1 ? "skAbsence" : "skAbsences", [aAbsences.length]));

			if (!SicknessService.isBound()) {
				oViewModel.setProperty("/alert", { text: this.getText("skNotBoundStrip"), type: "Information" });
			} else if (iOpen) {
				oViewModel.setProperty("/alert", {
					text: this.getText(iOpen === 1 ? "skTriggerCount" : "skTriggerCountPlural", [iOpen]),
					type: "Error"
				});
			} else {
				oViewModel.setProperty("/alert", { text: this.getText(iDismissed ? "skNoOpenTriggersAlert" : "skNoTriggersAlert"), type: "Success" });
			}
		},

		_toAbsence: function (oRaw) {
			var oPerson = this._person(oRaw.EmpID);
			var sName = oRaw.Name || (oPerson && oPerson.FullName) || oRaw.EmpID || "";
			var sStart = Backend.dayKey(oRaw.StartDate);
			var sEnd = Backend.dayKey(oRaw.EndDate) || sStart;
			var fDays = parseFloat(oRaw.Days) || 0;

			return {
				AbsenceID: oRaw.AbsenceID,
				EmpID: oRaw.EmpID,
				Name: sName,
				Email: oRaw.Email || (oPerson && oPerson.Email) || "",
				initials: formatter.nameInitials(sName),
				StartDate: sStart,
				EndDate: sEnd,
				Days: fDays,
				Reason: oRaw.Reason || "",
				Notes: oRaw.Notes || "",
				FitNote: oRaw.FitNote === "Y" || oRaw.FitNote === true,
				dateText: this._rangeText(sStart, sEnd),
				durationText: this._daysText(fDays),
				dismissed: false,
				dismissedTooltip: "",
				dismissedNote: ""
			};
		},

		_toTrigger: function (oTrigger) {
			var oPerson = this._person(oTrigger.EmpID);
			var sName = oTrigger.Name || (oPerson && oPerson.FullName) || oTrigger.EmpID;
			var sEmail = (oPerson && oPerson.Email) || oTrigger.absences.reduce(function (sFound, oAbsence) {
				return sFound || oAbsence.Email;
			}, "");
			var bDismissed = oTrigger.status === "DISMISSED";
			var sEmailedOn = Backend.dayKey(oTrigger.emailedOn);

			return Object.assign({}, oTrigger, {
				Name: sName,
				Email: sEmail,
				firstName: sName.split(/\s+/)[0],
				initials: formatter.nameInitials(sName),
				summary: this.getText("skSummary", [oTrigger.instances, this._daysText(oTrigger.days)]),
				historyCount: this.getText(oTrigger.instances === 1 ? "skAbsence" : "skAbsences", [oTrigger.instances]),
				dismissText: this.getText("skDismissButton", [sName.split(/\s+/)[0]]),
				noteText: bDismissed ? this.getText("skDismissedNote", [oTrigger.note]) : "",
				emailedText: sEmailedOn ?
					this.getText("skEmailedOn", [this._rangeText(sEmailedOn, sEmailedOn)]) : this.getText("skEmailed"),
				expanded: !!this._mExpanded[oTrigger.EmpID]
			});
		},

		_toRtw: function (oRaw) {
			var oPerson = this._person(oRaw.EmpID);
			var sName = oRaw.Name || (oPerson && oPerson.FullName) || oRaw.EmpID || "";

			return {
				RtwID: oRaw.RtwID,
				EmpID: oRaw.EmpID,
				Name: sName,
				Title: oRaw.Title || "",
				Email: oRaw.Email || (oPerson && oPerson.Email) || "",
				initials: formatter.nameInitials(sName),
				steps: (oRaw.Steps || []).slice().sort(function (a, b) {
					return (a.StepNo || 0) - (b.StepNo || 0);
				}).map(function (oStep) {
					return {
						RtwID: oRaw.RtwID,
						StepNo: oStep.StepNo,
						Text: oStep.Text || "",
						done: oStep.Done === "Y" || oStep.Done === true
					};
				})
			};
		},

		/* =========================================================== */
		/* events: page                                                */
		/* =========================================================== */

		onRefresh: function () {
			if (this._oProfile && this._oProfile.isManager) {
				this._load();
			}
		},

		/**
		 * Steps one financial year back or forward. There is nothing to show beyond
		 * the current year, so the forward button stops there.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onStepYear: function (oEvent) {
			var iStep = oEvent.getSource().data("step") === "next" ? 1 : -1;
			var oViewModel = this.getModel("skView");
			var iCurrent = SicknessPolicy.fiscalYearOf(new Date()).startYear;
			var iYear = Math.min(oViewModel.getProperty("/year/startYear") + iStep, iCurrent);

			this._mExpanded = {};
			this.getModel("sk").setProperty("/triggers", []);
			oViewModel.setProperty("/year", SicknessPolicy.fiscalYear(iYear));
			oViewModel.setProperty("/isCurrentYear", iYear === iCurrent);
			this._load();
		},

		/* =========================================================== */
		/* events: record sickness                                     */
		/* =========================================================== */

		onOpenRecord: function () {
			this.setModel(new JSONModel({
				EmpID: "",
				Reason: "",
				Notes: "",
				FitNote: false,
				Days: 0,
				datesPicked: false,
				daysText: this.getText("skPickDates"),
				canSave: false,
				saving: false
			}), "skForm");

			this._loadEmployees();
			this._dialog("_pRecordDialog", "RecordSicknessDialog").then(function (oDialog) {
				this.byId("skDates").setValue("");
				this.byId("skEmployee").setValueState("None");
				oDialog.open();
			}.bind(this));
		},

		/**
		 * Recounts the working days - against the chosen employee's own work pattern -
		 * and decides whether the absence can be recorded yet.
		 */
		onRecordInput: function () {
			var oForm = this.getModel("skForm");
			var oDates = this.byId("skDates");
			var oFrom = oDates.getDateValue();
			var oTo = oDates.getSecondDateValue() || oFrom;
			var oEmployee = this.byId("skEmployee");
			var sEmpId = oEmployee.getSelectedKey();

			// A name typed that matches nobody leaves no key behind - say so rather than
			// silently refusing to save.
			oEmployee.setValueState(oEmployee.getValue() && !sEmpId ? "Error" : "None");
			oEmployee.setValueStateText(this.getText("skEmployeeUnknown"));

			var iDays = oFrom ? SicknessPolicy.workingDays(oFrom, oTo, SicknessPolicy.workPattern(this._person(sEmpId))) : 0;
			var sDaysText = !oFrom ? this.getText("skPickDates") :
				iDays ? this.getText(iDays === 1 ? "skWorkingDay" : "skWorkingDays", [iDays]) : this.getText("skNoWorkingDays");

			oForm.setProperty("/EmpID", sEmpId);
			oForm.setProperty("/Days", iDays);
			oForm.setProperty("/datesPicked", !!oFrom);
			oForm.setProperty("/daysText", sDaysText);
			oForm.setProperty("/canSave", !!sEmpId && iDays > 0 && !!String(this.byId("skReason").getValue()).trim());
		},

		onSaveRecord: function () {
			var oForm = this.getModel("skForm");
			var oDates = this.byId("skDates");
			var oFrom = oDates.getDateValue();
			var oTo = oDates.getSecondDateValue() || oFrom;
			var iDays = oForm.getProperty("/Days");

			oForm.setProperty("/saving", true);

			SicknessService.recordAbsence({
				OrgID: this._sOrgId,
				EmpID: oForm.getProperty("/EmpID"),
				StartDate: SicknessPolicy.isoDate(oFrom),
				EndDate: SicknessPolicy.isoDate(oTo),
				Days: iDays,
				Reason: oForm.getProperty("/Reason").trim(),
				Notes: oForm.getProperty("/Notes").trim(),
				FitNote: oForm.getProperty("/FitNote") ? "Y" : "N",
				RecordedBy: this._oProfile.email,
				RtwSteps: SicknessPolicy.rtwSteps(!!oForm.getProperty("/FitNote"))
			}).then(function () {
				this.byId("recordSicknessDialog").close();
				MessageToast.show(this.getText(iDays === 1 ? "skRecordedDay" : "skRecordedDays", [iDays]));
				this._load();
			}.bind(this)).catch(function (oError) {
				oForm.setProperty("/saving", false);
				this._showError("skErrorRecord", oError);
			}.bind(this));
		},

		onCancelRecord: function () {
			this.byId("recordSicknessDialog").close();
		},

		onRecordAfterClose: function () {
			this.getModel("skForm").setProperty("/saving", false);
		},

		/* =========================================================== */
		/* events: policy triggers                                     */
		/* =========================================================== */

		/**
		 * Opens the admin's own mail app with a draft check-in to the employee, and
		 * logs the email against their attendance record. The trigger stays open -
		 * only a dismissal closes it - but is marked as emailed.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onSendFollowUp: function (oEvent) {
			var oTrigger = oEvent.getSource().getBindingContext("sk").getObject();

			if (!oTrigger.Email) {
				MessageBox.error(this.getText("skNoEmail", [oTrigger.Name]));
				return;
			}

			var sBody = this.getText("skFollowUpBody", [oTrigger.firstName, oTrigger.instances]);
			Mail.open({ to: oTrigger.Email, subject: this.getText("skFollowUpSubject"), body: sBody });

			this._review(oTrigger, "EMAILED", sBody).then(function () {
				MessageToast.show(this.getText("skFollowUpLogged"));
			}.bind(this)).catch(function (oError) {
				this._showError("skErrorFollowUp", oError);
			}.bind(this));
		},

		onOpenDismiss: function (oEvent) {
			this._oDismissing = oEvent.getSource().getBindingContext("sk").getObject();
			this.setModel(new JSONModel({ Note: "", canSave: false, saving: false }), "skDismiss");

			this._dialog("_pDismissDialog", "DismissTriggerDialog").then(function (oDialog) {
				oDialog.open();
			});
		},

		onDismissInput: function (oEvent) {
			this.getModel("skDismiss").setProperty("/canSave", !!String(oEvent.getParameter("value") || "").trim());
		},

		onConfirmDismiss: function () {
			var oDismiss = this.getModel("skDismiss");
			var oTrigger = this._oDismissing;

			oDismiss.setProperty("/saving", true);

			this._review(oTrigger, "DISMISSED", oDismiss.getProperty("/Note").trim()).then(function () {
				this.byId("dismissTriggerDialog").close();
				MessageToast.show(this.getText("skDismissed", [oTrigger.firstName]));
			}.bind(this)).catch(function (oError) {
				oDismiss.setProperty("/saving", false);
				this._showError("skErrorDismiss", oError);
			}.bind(this));
		},

		onCancelDismiss: function () {
			this.byId("dismissTriggerDialog").close();
		},

		onDismissAfterClose: function () {
			this._oDismissing = null;
		},

		/**
		 * Logs an action on a trigger and reloads the page to show it.
		 * @param {object} oTrigger the trigger
		 * @param {string} sStatus "EMAILED" or "DISMISSED"
		 * @param {string} sNote the follow-up sent, or the reason for dismissing
		 * @returns {Promise} resolved once the review is logged
		 */
		_review: function (oTrigger, sStatus, sNote) {
			return SicknessService.reviewTrigger({
				OrgID: this._sOrgId,
				EmpID: oTrigger.EmpID,
				FiscalYear: this.getModel("skView").getProperty("/year/startYear"),
				Status: sStatus,
				Note: sNote,
				InstanceCount: oTrigger.instances,
				ReviewedBy: this._oProfile.email
			}).then(function () {
				this._load();
			}.bind(this));
		},

		/* =========================================================== */
		/* events: return to work                                      */
		/* =========================================================== */

		onMarkStepDone: function (oEvent) {
			var oStep = oEvent.getSource().getBindingContext("sk").getObject();

			SicknessService.completeRtwStep(oStep.RtwID, oStep.StepNo, this._oProfile.email).then(function () {
				MessageToast.show(this.getText("skStepDone"));
				this._load();
			}.bind(this)).catch(function (oError) {
				this._showError("skErrorStep", oError);
			}.bind(this));
		},

		onEmailRtw: function (oEvent) {
			var oRtw = oEvent.getSource().getBindingContext("sk").getObject();
			Mail.open({ to: oRtw.Email, subject: this.getText("skRtwSubject") });
		},

		onCompleteRtw: function (oEvent) {
			var oRtw = oEvent.getSource().getBindingContext("sk").getObject();
			var iOutstanding = oRtw.steps.filter(function (oStep) {
				return !oStep.done;
			}).length;

			if (iOutstanding) {
				MessageToast.show(this.getText(iOutstanding === 1 ? "skStepOutstanding" : "skStepsOutstanding", [iOutstanding]));
				return;
			}

			SicknessService.completeRtw(oRtw.RtwID, this._oProfile.email).then(function () {
				MessageToast.show(this.getText("skRtwCompleted", [oRtw.Name]));
				this._load();
			}.bind(this)).catch(function (oError) {
				this._showError("skErrorRtw", oError);
			}.bind(this));
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

		getResourceBundle: function () {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle();
		},

		getText: function (sKey, aArgs) {
			return this.getResourceBundle().getText(sKey, aArgs);
		},

		_person: function (sEmpId) {
			return (sEmpId && this._mPeople && this._mPeople[sEmpId]) || null;
		},

		/**
		 * Loads a dialog fragment once and keeps it for the life of the view.
		 * @param {string} sHandle the member that holds the loading promise
		 * @param {string} sName the fragment name
		 * @returns {Promise<sap.m.Dialog>} the dialog
		 */
		_dialog: function (sHandle, sName) {
			if (!this[sHandle]) {
				this[sHandle] = Fragment.load({
					id: this.getView().getId(),
					name: "bsx.hrx.hrx2026.fragment." + sName,
					controller: this
				}).then(function (oDialog) {
					this.getView().addDependent(oDialog);
					return oDialog;
				}.bind(this));
			}
			return this[sHandle];
		},

		/**
		 * @param {number} fDays a number of days
		 * @returns {string} e.g. "1 day", "3 days", "2.5 days"
		 */
		_daysText: function (fDays) {
			var sDays = Number.isInteger(fDays) ? String(fDays) : fDays.toFixed(1);
			return this.getText(fDays === 1 ? "skDay" : "skDays", [sDays]);
		},

		/**
		 * @param {string} sStart the first day, "yyyy-MM-dd"
		 * @param {string} sEnd the last day, "yyyy-MM-dd"
		 * @returns {string} e.g. "22 Jun 2026", "13 – 14 Jul 2026", "30 Jun – 2 Jul 2026"
		 */
		_rangeText: function (sStart, sEnd) {
			if (!sStart) {
				return "";
			}
			var oStart = SicknessPolicy.parseDay(sStart);
			var oEnd = SicknessPolicy.parseDay(sEnd || sStart);
			var sEndText = oEnd.getDate() + " " + MONTHS[oEnd.getMonth()] + " " + oEnd.getFullYear();

			if (sStart === sEnd || !sEnd) {
				return sEndText;
			}
			if (oStart.getFullYear() !== oEnd.getFullYear()) {
				return oStart.getDate() + " " + MONTHS[oStart.getMonth()] + " " + oStart.getFullYear() + " – " + sEndText;
			}
			if (oStart.getMonth() !== oEnd.getMonth()) {
				return oStart.getDate() + " " + MONTHS[oStart.getMonth()] + " – " + sEndText;
			}
			return oStart.getDate() + " – " + sEndText;
		},

		/**
		 * Until the sickness service is bound every write fails the same way, and the
		 * admin needs to hear that rather than a generic error.
		 * @param {string} sTextKey the message for a real failure
		 * @param {Error} oError the failure
		 */
		_showError: function (sTextKey, oError) {
			if (oError && oError.notBound) {
				MessageBox.information(this.getText("skNotBound"));
				return;
			}
			MessageBox.error(this.getText(sTextKey), {
				details: (oError && oError.message) || String(oError)
			});
		}
	});
});
