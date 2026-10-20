sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageToast",
	"sap/m/MessageBox",
	"../model/Backend",
	"../model/formatter",
	"../model/CurrentUser",
	"sap/m/Dialog",
	"sap/m/Button",
	"sap/m/Label",
	"sap/m/Text",
	"sap/m/TextArea",
	"sap/m/VBox",
	"../model/Hrx",
	"../model/HrxTime",
	"../model/HrxLegacy",
	"../model/SicknessPolicy",
	"../model/SicknessService",
	"../model/Documents",
	"../model/DocumentService",
	"../model/TimesheetReport",
	"../model/TimesheetReportService",
	"sap/base/security/encodeXML"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, MessageBox,
	Backend, formatter, CurrentUser, Dialog, Button, Label, Text, TextArea, VBox,
	Hrx, HrxTime, HrxLegacy, SicknessPolicy, SicknessService, Documents, DocumentService,
	TimesheetReport, TimesheetReportService, encodeXML) {
	"use strict";

	// abbrev matches the day fields exposed by the /Resources OData entity.
	var DAYS = [
		{ label: "Mon", schedule: "Monday", abbrev: "Mo" },
		{ label: "Tue", schedule: "Tuesday", abbrev: "Tu" },
		{ label: "Wed", schedule: "Wednesday", abbrev: "We" },
		{ label: "Thu", schedule: "Thursday", abbrev: "Th" },
		{ label: "Fri", schedule: "Friday", abbrev: "Fr" },
		{ label: "Sat", schedule: "Saturday", abbrev: "Sa" },
		{ label: "Sun", schedule: "Sunday", abbrev: "Su" }
	];

	return Controller.extend("bsx.hrx.hrx2026.controller.Home", {

		formatter: formatter,

		/* =========================================================== */
		/* lifecycle                                                   */
		/* =========================================================== */

		onInit: function () {
			// Deliberately no service call here: the signed-in user is still being
			// resolved at this point, and asking a service for an empty Email does not
			// mean "nobody", it means "match anybody". Everything waits on the profile
			// in _onRouteMatched instead.
			this._sOrgId = CurrentUser.orgId(this.getOwnerComponent());
			this._sUserEmail = "";
			this.getView().setModel(new JSONModel(this._emptyState()), "home");

			this.getOwnerComponent().getRouter().getRoute("home")
				.attachPatternMatched(this._onRouteMatched, this);

			// The cards' drop-downs always open under their field. By default a long
			// list with little room below flips above it, away from the field it
			// belongs to; below, it stops at the window's edge and scrolls instead.
			["qtProject", "qlType", "qlDuration"].forEach(function (sId) {
				var oPicker = this.byId(sId).getPicker();
				// On a phone the picker is a full-screen dialog, with no placement.
				if (oPicker && typeof oPicker.setPlacement === "function") {
					oPicker.setPlacement("Bottom");
				}
			}, this);
		},


		/**
		 * The view is reused across navigations, so every entry comes back to today with
		 * fresh figures.
		 */
		_onRouteMatched: function () {
			var oModel = this.getModel();
			oModel.setProperty("/quick", this._emptyQuickEntry());
			oModel.setProperty("/quickLeave", this._emptyQuickLeave());
			this.byId("qlDates").setValueState("None");

			var oComponent = this.getOwnerComponent();

			// Component.init already resolved this, and it is built never to reject.
			// Asking _getLoggedinUserEmail() again here fetched /user-api/currentUser a
			// second time, which 404s with no approuter in front of a local run and
			// rejected the whole chain - taking the week, the day and the approvals
			// down with it.
			CurrentUser.ready(oComponent).then(function (oProfile) {
				this._oProfile = oProfile;
				this._sUserEmail = oProfile.email;
				this._sOrgId = oProfile.orgId;
				this._pWorkScheduleLoaded = this._loadWorkSchedule(oProfile.email);

				if (!oProfile.email) {
					// Nobody to load anything for. Say so rather than firing service
					// calls that would match everybody.
					oModel.setProperty("/weekRings", []);
					oModel.setProperty("/approvals", []);
					if (CurrentUser.shouldReportMissingIdentity()) {
						this._showError("homeErrorNoIdentity", null);
					}
					return;
				}

				this._loadLeaveTypes();
				this._loadDay();

				// Approvals are loaded for everybody, not only for a profile the team
				// service happened to flag as a manager: that flag went missing often
				// enough that the home page showed nothing while the same requests were
				// sitting in the team calendar. The card shows itself once there is
				// something in it (see the view), so a non-manager still sees nothing.
				Promise.all([
					this._loadWeek(),
					this._loadLeaveUser(),
					this._loadApprovals()
				]).then(function () {
					this._updateHealthStrip();
				}.bind(this));

				this._loadDashboard();
			}.bind(this)).catch(function (oError) {
				// Spell the reason out: the rejection is often a plain response object,
				// which logs as an empty second argument and says nothing.
				console.error("Home _onRouteMatched failed",
					(oError && (oError.stack || oError.message)) || oError, oError);
			});
		},

		/**
		 * Reloads everything on the page. Called by the shell bar's reload button, which
		 * now serves whichever page is on screen.
		 * @returns {Promise} resolved once the page has been refilled
		 */
		onRefresh: function () {
			if (!this._sUserEmail) {
				return Promise.resolve();
			}

			return Promise.all([
				this._loadWeek(),
				this._loadDay(),
				this._loadLeaveUser(),
				this._loadApprovals(),
				this._loadDashboard()
			]).then(function () {
				this._updateHealthStrip();
			}.bind(this));
		},

		_weekDates: function (oMonday) {
			return DAYS.map(function (oDay, iIndex) {
				return new Date(oMonday.getFullYear(), oMonday.getMonth(), oMonday.getDate() + iIndex);
			});
		},

		/* =========================================================== */
		/* data loading                                                */
		/* =========================================================== */

		/**
		 * Leave types back the Quick Leave picker. They are stable, so they are read once
		 * per visit straight from the OData service.
		 * @returns {Promise} resolved once the types are in the model
		 */
		_loadLeaveTypes: function () {
			if (this.getModel().getProperty("/leaveTypes").length) {
				return Promise.resolve();
			}

			// Backend.read, not a bare model.read: it waits for the service metadata,
			// including the retries Component.js makes after a failed first attempt. A
			// momentary outage at startup used to leave this picker empty - "no data" -
			// for the rest of the session with nothing on screen to say why.
			return Backend.read(this.getOwnerComponent().getModel(), "/LeaveTypes", {
				filters: [new Filter("OrgID", FilterOperator.EQ, this._sOrgId)]
			}).then(function (oData) {
				this.getModel().setProperty("/leaveTypes", (oData.results || []).map(function (oType) {
					return {
						LeaveCategoryId: oType.LeaveCategoryId,
						LeaveCategoryDesc: oType.LeaveCategoryDesc
					};
				}));
			}.bind(this)).catch(function (oError) {
				this.getModel().setProperty("/leaveTypes", []);
				this._showError("mlErrorLookups", oError);
			}.bind(this));
		},

		_mondayOf: function (oDate) {
			var oCopy = new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate());
			var iOffset = (oCopy.getDay() + 6) % 7;
			oCopy.setDate(oCopy.getDate() - iOffset);
			return oCopy;
		},

		/**
		 * The leave block carries the approver and the remaining balance the Quick Leave
		 * card needs.
		 * @returns {Promise} resolved once the block is in the model
		 */
		_loadLeaveUser: function () {
			return Backend.getJson(Backend.query(Backend.LEAVE, {
				cmd: "fetchUser",
				Email: this._sUserEmail,
				OrgID: this._sOrgId
			})).then(function (oData) {
				var oUser = oData.user || {};
				// The picture arrives as a large data url and nothing here shows it.
				delete oUser.pic;
				this.getModel().setProperty("/user", oUser);
			}.bind(this)).catch(function (oError) {
				this._showError("homeErrorLeaveUser", oError);
			}.bind(this));
		},

		/**
		 * Reads the signed-in user's weekly work schedule straight from /Resources, rather
		 * than trusting whatever the timesheet fetch happens to echo back.
		 * @param {string} sEmail the signed-in user's email
		 * @returns {Promise} resolved once this._oWorkSchedule is filled
		 */
		_loadWorkSchedule: function (sEmail) {
			if (!sEmail) {
				// No signed-in identity to filter on - e.g. a BAS preview with no
				// approuter session. Every resource has a real email, so this query
				// would only ever come back empty; skip it rather than send a doomed
				// request that can take the rest of the batch down with it.
				this._oWorkSchedule = this._defaultSchedule();
				return Promise.resolve();
			}

			// The org's resources are read and matched here, not filtered on Email in
			// the request: that filter is case-sensitive, and an email stored with
			// capitals (Soumya.Sharma@...) matched nobody. With no schedule every day,
			// weekends included, counted as a working day, so a 40-hour week owed 5:43 a
			// day and an 8-hour day read 140%.
			return Backend.read(this.getOwnerComponent().getModel(), "/Resources", {
				urlParameters: { "$select": "Email," + DAYS.map(function (oDay) { return oDay.abbrev; }).join(",") },
				filters: [new Filter("OrgID", FilterOperator.EQ, this._sOrgId)]
			}).then(function (oData) {
				var oResource = (oData.results || []).filter(function (oRow) {
					return CurrentUser.sameEmail(oRow.Email, sEmail);
				})[0];
				this._oWorkSchedule = oResource ? DAYS.reduce(function (oSchedule, oDay) {
					oSchedule[oDay.schedule] = oResource[oDay.abbrev];
					return oSchedule;
				}, {}) : this._defaultSchedule();
			}.bind(this)).catch(function () {
				// A service hiccup falls back to Monday to Friday, as My Timesheet does,
				// rather than blocking the page.
				this._oWorkSchedule = this._defaultSchedule();
			}.bind(this));
		},

		/**
		 * @returns {object} Monday to Friday, for a user whose schedule is not on record
		 */
		_defaultSchedule: function () {
			return DAYS.reduce(function (oSchedule, oDay, iIndex) {
				oSchedule[oDay.schedule] = iIndex < 5 ? "Y" : "N";
				return oSchedule;
			}, {});
		},

		/**
		 * @param {object} oUser the user block of a timesheet response
		 * @returns {number} the minutes owed on a working day: the week's target spread
		 * over the days the work schedule has them working
		 */
		_targetPerDay: function (oUser) {
			var oSchedule = this._oWorkSchedule || this._defaultSchedule();
			var iWorkingDays = DAYS.filter(function (oDay) {
				return oSchedule[oDay.schedule] !== "N";
			}).length || 5;
			return Math.round(Backend.toMinutes((oUser || {}).targetHrsPerWeek) / iWorkingDays);
		},

		/**
		 * @param {object} oData a timesheet response
		 * @returns {object} minutes of leave and bank holiday, keyed by yyyy-MM-dd. A half
		 * day's leave is four hours of a day, not the whole of it.
		 */
		_absenceMinutes: function (oData) {
			var mMinutes = {};
			Backend.countedLeaves(oData.leaves).concat(oData.bankHolidays || []).forEach(function (oEntry) {
				var sDate = Backend.dayKey(oEntry.Date);
				mMinutes[sDate] = (mMinutes[sDate] || 0) + Backend.toMinutes(oEntry.Hours);
			});
			return mMinutes;
		},

		/**
		 * Reads one week of bookings. Both the ring row and the Quick Timesheet card work
		 * off this response.
		 * @param {Date} oMonday the first day of the week
		 * @returns {Promise<object>} the service response
		 */
		_fetchWeek: function (oMonday) {
			var aDates = Backend.weekDates(oMonday);

			return Backend.getJson(Backend.query(Backend.TIMESHEET, {
				cmd: "fetch",
				Email: this._sUserEmail,
				FromDate: Backend.isoDate(aDates[0]),
				ToDate: Backend.isoDate(aDates[6]),
				OrgID: this._sOrgId
			})).then(function (oData) {
				this._sUserId = (oData.user || {}).empID || this._sUserId;
				return oData;
			}.bind(this));
		},

		/**
		 * Builds the ring for each day of this week: complete, short, missing, on leave,
		 * or not due yet.
		 * @returns {Promise} resolved once the rings are in the model
		 */
		_loadWeek: function () {
			var oModel = this.getModel();
			var oMonday = Backend.mondayOf(new Date());
			var aDates = Backend.weekDates(oMonday);

			oModel.setProperty("/loadingWeek", true);
			oModel.setProperty("/week/label", formatter.dateRange(aDates[0], aDates[6]));

			return Promise.all([this._fetchWeek(oMonday), this._pWorkScheduleLoaded]).then(function (aResults) {
				var oData = aResults[0];
				var oUser = oData.user || {};
				var oSchedule = this._oWorkSchedule || this._defaultSchedule();

				this._oWeekTotals = this._weekTotals(oData);
				oModel.setProperty("/week/status", this._weekStatus(this._oWeekTotals));
				var mAbsence = this._absenceMinutes(oData);
				var iTargetPerDay = this._targetPerDay(oUser);
				var sToday = Backend.isoDate(new Date());

				// The design shows the working week. A day the person does not work is
				// left out, unless time was booked against it anyway.
				var aRings = [];
				DAYS.forEach(function (oDay, iIndex) {
					var sDate = Backend.isoDate(aDates[iIndex]);
					var bWorking = oSchedule[oDay.schedule] !== "N";
					var iBooked = this._bookedMinutes(oData, sDate);

					if (!bWorking && !iBooked) {
						return;
					}

					// A day off owes no time at all, so anything booked against it is
					// already more than was asked for - but only once there is a target to
					// be over. Without one (a resource with no weekly hours on record)
					// nothing can be judged either way, so no day is called overbooked.
					// Leave and bank holidays take their hours off the day's target: half a
					// day's leave leaves the other half owed, rather than the whole day.
					var iAbsence = mAbsence[sDate] || 0;
					var iDayTarget = bWorking ? Math.max(iTargetPerDay - iAbsence, 0) : 0;
					var bOverbooked = iTargetPerDay > 0 && iBooked > iDayTarget;
					// The ring never fills past 100%: what was booked is in its middle, what
					// was due underneath, so an overbooked day reads as hours, not 140%.
					var fPercent = iDayTarget ? Math.min(iBooked * 100 / iDayTarget, 100) : 0;
					var sHours = this._hoursLabel(iBooked);
					var sDue = iDayTarget ? this.getText("homeRingDue", [Backend.fromMinutes(iDayTarget)]) : "";

					// On leave for the whole of it - or on leave at all on a day off.
					if (iAbsence && !iDayTarget) {
						aRings.push(this._ring(oDay.label, "leave", 100, "", this.getText("legendOnLeave")));
						return;
					}

					// Checked ahead of the not-due-yet branch: time booked over target on
					// a day still to come is just as overbooked as on a day gone by.
					if (bOverbooked) {
						aRings.push(this._ring(oDay.label, "over", 100, sHours, this.getText("ringTooltipOverbooked", [
							Backend.fromMinutes(iBooked),
							Backend.fromMinutes(iDayTarget),
							Backend.fromMinutes(iBooked - iDayTarget)
						]), sDue));
						return;
					}

					if (!bWorking || sDate > sToday) {
						aRings.push(this._ring(oDay.label, "notdue", fPercent, iBooked ? sHours : "–",
							bWorking
								? this.getText("ringTooltipNotDue", [Backend.fromMinutes(iBooked), Backend.fromMinutes(iDayTarget)])
								: this.getText("qtNonWorkingDay"), sDue));
						return;
					}

					var sTone = iBooked >= iDayTarget ? "complete" : (iBooked > 0 ? "short" : "missing");
					aRings.push(this._ring(oDay.label, sTone, fPercent, sHours, this.getText("ringTooltipBooked", [
						Backend.fromMinutes(iBooked), Backend.fromMinutes(iDayTarget)
					]), sDue));
				}, this);

				oModel.setProperty("/weekRings", aRings);
				oModel.setProperty("/weekHasOverbooked", aRings.some(function (oRing) {
					return oRing.tone === "over";
				}));

				oModel.setProperty("/loadingWeek", false);
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/weekRings", []);
				oModel.setProperty("/week/status", this._weekStatus(null));
				oModel.setProperty("/loadingWeek", false);
				this._showError("homeErrorWeek", oError);
			}.bind(this));
		},

		/**
		 * Adds up what has been booked this week against what is owed, with leave and
		 * bank holidays reducing the target rather than counting as booked time.
		 * @param {object} oData the timesheet response
		 * @returns {object|null} the booked and target minutes
		 */
		_weekTotals: function (oData) {
			if (!oData || !oData.user) {
				return null;
			}

			var iBooked = this._timeEntries(oData).reduce(function (iTotal, oItem) {
				return iTotal + Backend.toMinutes(oItem.entry.Hours);
			}, 0);

			var iTarget = Backend.toMinutes(oData.user.targetHrsPerWeek);
			iTarget -= Backend.countedLeaves(oData.leaves).reduce(function (iTotal, oEntry) {
				return iTotal + Backend.toMinutes(oEntry.Hours);
			}, 0);
			iTarget -= (oData.bankHolidays || []).filter(function (oEntry) {
				return oEntry.Day !== "Saturday" && oEntry.Day !== "Sunday";
			}).reduce(function (iTotal, oEntry) {
				return iTotal + Backend.toMinutes(oEntry.Hours);
			}, 0);

			return { booked: iBooked, target: Math.max(iTarget, 0) };
		},

		/**
		 * Builds the health-strip pills shown at the top of the shell from data this
		 * page has already fetched for itself - the week just loaded, the leave-user
		 * balance and the approvals list - rather than App.controller fetching the same
		 * week/leave/approvals a second time.
		 */
		_updateHealthStrip: function () {
			var oAppController = this.getOwnerComponent().getRootControl().getController();
			if (!oAppController || typeof oAppController.setHealthStrip !== "function") {
				return;
			}

			var oModel = this.getModel();
			var aStrip = [];

			// The design's strip leads with this week's timesheet: on track, or the
			// hours still to book.
			// Each pill names the page it opens (see App.controller _onHealthPillPress).
			var oWeekStatus = this._weekStatus(this._oWeekTotals);
			if (oWeekStatus.text) {
				aStrip.push(Object.assign({}, oWeekStatus, {
					route: "timesheet",
					tooltip: this.getText("stripOpenTimesheet")
				}));
			}

			// One pill per person waiting, not per day, so it lines up with the
			// approvals card on the home page.
			var iPending = (oModel.getProperty("/approvals") || []).length;
			if (iPending) {
				aStrip.push({
					text: this.getText(iPending === 1 ? "homeStripApproval" : "homeStripApprovals", [iPending]),
					state: "Warning",
					route: "teamcal",
					tooltip: this.getText("stripOpenApprovals")
				});
			}

			var oUser = oModel.getProperty("/user") || {};
			if (oUser.email) {
				var fBalance = parseFloat(oUser.balanceLeaves) || 0;
				aStrip.push({
					text: this.getText("stripLeaveBalance", [fBalance]),
					state: fBalance > 0 ? "Success" : "Error",
					route: "leave",
					tooltip: this.getText("stripOpenLeave")
				});
			}

			oAppController.setHealthStrip(aStrip);
		},

		/**
		 * @param {object|null} oTotals the week's booked and target minutes
		 * @returns {object} the pill on the Timesheet card: what is still to book, or
		 * that the week is on track - empty when there is no week to judge
		 */
		_weekStatus: function (oTotals) {
			if (!oTotals) {
				return { text: "", state: "None" };
			}
			if (oTotals.booked >= oTotals.target) {
				return { text: this.getText("stripTimesheetOnTrack"), state: "Success" };
			}
			return {
				text: this.getText("stripTimesheetShort", [Backend.fromMinutes(oTotals.target - oTotals.booked)]),
				state: "Warning"
			};
		},

		/**
		 * One day of the Timesheet card.
		 * @param {string} sDay the day's short name, e.g. "Mon"
		 * @param {string} sTone missing, short, complete, over, leave or notdue
		 * @param {number} fPercent how much of the ring to fill, 0 to 100
		 * @param {string} sText the figure inside the ring
		 * @param {string} sTooltip the hover text on the day
		 * @param {string} [sDue] the hours due that day, shown under the ring
		 * @returns {object} the ring's row in home>/weekRings
		 */
		_ring: function (sDay, sTone, fPercent, sText, sTooltip, sDue) {
			return {
				day: sDay,
				tone: sTone,
				onLeave: sTone === "leave",
				due: sDue || "",
				tooltip: sTooltip,
				svg: this._ringSvg(sTone, fPercent, sText)
			};
		},

		/**
		 * The design's 44px day ring: a soft track, the booked share drawn over it
		 * from twelve o'clock, and the hours in the middle. A day of leave is a filled
		 * circle with a tick instead. The colours come from css/pages/home.css, keyed
		 * on data-tone.
		 * @param {string} sTone missing, short, complete, over, leave or notdue
		 * @param {number} fPercent how much of the ring to fill, 0 to 100
		 * @param {string} sText the figure inside the ring
		 * @returns {string} the ring as SVG markup
		 */
		_ringSvg: function (sTone, fPercent, sText) {
			var sOpen = "<svg class=\"hrxHomeRing\" data-tone=\"" + sTone + "\" width=\"44\" height=\"44\" " +
				"viewBox=\"0 0 44 44\" aria-hidden=\"true\">";

			if (sTone === "leave") {
				return sOpen +
					"<circle class=\"hrxHomeRingFill\" cx=\"22\" cy=\"22\" r=\"18\"/>" +
					"<path class=\"hrxHomeRingTick\" d=\"M15 22l4 4 9-9\"/>" +
					"</svg>";
			}

			// The circle's length is 2 * pi * 18 = 113.1. A missing day still shows
			// the dot the design draws at twelve o'clock.
			var fLength = 113.1;
			var fArc = fPercent * fLength / 100;
			if (sTone === "missing") {
				fArc = Math.max(fArc, 1);
			}

			var sArc = fArc > 0
				? "<circle class=\"hrxHomeRingArc\" cx=\"22\" cy=\"22\" r=\"18\" stroke-dasharray=\"" +
					fArc.toFixed(1) + " " + fLength + "\" transform=\"rotate(-90 22 22)\"/>"
				: "";

			return sOpen +
				"<circle class=\"hrxHomeRingTrack\" cx=\"22\" cy=\"22\" r=\"18\"/>" +
				sArc +
				"<text class=\"hrxHomeRingText\" x=\"22\" y=\"26\" text-anchor=\"middle\">" +
				encodeXML(sText) + "</text>" +
				"</svg>";
		},

		/**
		 * Minutes as the ring's figure: whole hours as a plain number ("0", "8"), so
		 * most days read cleanly, and part of an hour as hours and minutes ("3:30").
		 * @param {number} iMinutes the minutes booked
		 * @returns {string} the hours
		 */
		_hoursLabel: function (iMinutes) {
			if (iMinutes % 60 === 0) {
				return String(iMinutes / 60);
			}
			return Backend.fromMinutes(iMinutes);
		},

		/**
		 * @param {object} oData a timesheet response
		 * @param {string} sDate the day as yyyy-MM-dd
		 * @returns {number} the minutes booked on that day
		 */
		_bookedMinutes: function (oData, sDate) {
			return this._timeEntries(oData).filter(function (oItem) {
				return Backend.dayKey(oItem.entry.Date) === sDate;
			}).reduce(function (iTotal, oItem) {
				return iTotal + Backend.toMinutes(oItem.entry.Hours);
			}, 0);
		},

		/**
		 * The week's time entries, one per project per day - as My Timesheet shows them.
		 * A project can come back on more than one assignment row, and each of those rows
		 * carries the project's entries, so adding up every row's entries counted that
		 * project's time once per row. Keyed the way the grid's _buildRows is, where a
		 * later row's entry for the same day replaces an earlier one.
		 * @param {object} oData a timesheet response
		 * @returns {Array<{assignment: object, entry: object}>} each entry with the row it came on
		 */
		_timeEntries: function (oData) {
			var mEntries = {};
			(oData.assignments || []).forEach(function (oAssignment) {
				(oAssignment.TimeEntries || []).forEach(function (oEntry) {
					mEntries[oAssignment.ProjectID + "|" + Backend.dayKey(oEntry.Date)] = {
						assignment: oAssignment,
						entry: oEntry
					};
				});
			});
			return Object.keys(mEntries).map(function (sKey) {
				return mEntries[sKey];
			});
		},

		/**
		 * Loads the day chosen in the Quick Timesheet card: which projects can be booked
		 * against, and what has already been logged.
		 * @returns {Promise} resolved once the card is filled
		 */
		_loadDay: function () {
			var oModel = this.getModel();
			var sDay = oModel.getProperty("/quick/day");
			var oDay = formatter.toDate(sDay);
			if (!oDay) {
				return Promise.resolve();
			}

			oModel.setProperty("/loadingDay", true);
			oModel.setProperty("/quick/dayLabel", this._dayLabel(oDay));
			oModel.setProperty("/quick/dayFullLabel", oDay.toLocaleDateString("en-GB", {
				weekday: "long", day: "numeric", month: "long", year: "numeric"
			}));

			return Promise.all([this._fetchWeek(Backend.mondayOf(oDay)), this._pWorkScheduleLoaded]).then(function (aResults) {
				var oData = aResults[0];
				var aAssignments = oData.assignments || [];
				var mSeen = {};
				var aProjects = [];
				var aEntries = [];
				var iBooked = 0;

				var oSchedule = this._oWorkSchedule || this._defaultSchedule();
				var sScheduleKey = oDay.toLocaleDateString("en-US", { weekday: "long" });
				var bWorking = oSchedule[sScheduleKey] !== "N";

				// Only a day the leave covers in full is closed to booking: on a half
				// day the other half is still to be booked.
				var iAbsence = this._absenceMinutes(oData)[sDay] || 0;
				var bFullyAway = iAbsence > 0 && iAbsence >= (this._targetPerDay(oData.user) || iAbsence);

				oModel.setProperty("/quick/dayEditable", bWorking && !bFullyAway);
				oModel.setProperty("/quick/dayEditableReason",
					bFullyAway ? this.getText("legendOnLeave") : (!bWorking ? this.getText("qtNonWorkingDay") : ""));

				// An assignment whose project the service no longer has (no name to
				// show) is left out, rather than listed as an empty "—" line.
				aAssignments.forEach(function (oAssignment) {
					var sProject = (oAssignment.ProjectDesc || "").trim();
					if (!sProject || mSeen[oAssignment.ProjectID]) {
						return;
					}
					mSeen[oAssignment.ProjectID] = true;
					var sClient = (oAssignment.ClientDesc || "").trim();
					aProjects.push({
						ProjectID: oAssignment.ProjectID,
						ClientKey: oAssignment.ClientKey,
						label: sClient ? sClient + " — " + sProject : sProject
					});
				});

				this._timeEntries(oData).forEach(function (oItem) {
					var oEntry = oItem.entry;
					if (Backend.dayKey(oEntry.Date) !== sDay) {
						return;
					}
					var sHours = this._trimSeconds(oEntry.Hours);
					if (!sHours || sHours === "00:00") {
						return;
					}
					iBooked += Backend.toMinutes(sHours);
					aEntries.push({
						ProjectID: oItem.assignment.ProjectID,
						project: oItem.assignment.ProjectDesc,
						time: sHours,
						comment: formatter.clean(oEntry.Comment),
						recId: oEntry.RecID || ""
					});
				}, this);

				aProjects.sort(function (a, b) {
					return a.label.localeCompare(b.label);
				});
				// The design's prompt, as the first choice of the list
				aProjects.unshift({ ProjectID: "", label: this.getText("homeProjectPlaceholder") });

				var bToday = sDay === Backend.isoDate(new Date());
				oModel.setProperty("/quick/loggedTitle", bToday
					? this.getText("homeLoggedToday")
					: this.getText("homeLoggedOn", [this._dayLabel(oDay)]));
				// Today reads as the design's "Monday, 19th October — resets automatically
				// at midnight" (the card goes back to the form on the next day); another
				// day picked from "Today" says how much is booked on it.
				var sLoggedSub = bToday
					? this.getText("homeLoggedTodaySub", [this._longDayLabel(oDay)])
					: this.getText("homeLoggedSub", [oModel.getProperty("/quick/dayFullLabel"), Backend.fromMinutes(iBooked)]);
				oModel.setProperty("/quick/loggedSub", sLoggedSub);

				oModel.setProperty("/quick/projects", aProjects);
				oModel.setProperty("/quick/entries", aEntries);
				oModel.setProperty("/quick/bookedTotal", Backend.fromMinutes(iBooked));
				oModel.setProperty("/quick/logged", aEntries.length > 0);
				oModel.setProperty("/loadingDay", false);
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/quick/projects", []);
				oModel.setProperty("/quick/entries", []);
				oModel.setProperty("/quick/logged", false);
				oModel.setProperty("/quick/dayEditable", false);
				oModel.setProperty("/quick/dayEditableReason", "");
				oModel.setProperty("/loadingDay", false);
				this._showError("homeErrorDay", oError);
			}.bind(this));
		},

		/**
		 * Loads the leave waiting for the signed-in manager's decision, one row per
		 * requester.
		 * @returns {Promise} resolved once the approvals are in the model
		 */
		_loadApprovals: function () {
			var oModel = this.getModel();
			oModel.setProperty("/loadingApprovals", true);
			return Backend.getJson(Backend.query(Backend.LEAVE_APPROVALS, {
				cmd: "pendingApproval",
				Email: this._sUserEmail,
				OrgID: this._sOrgId
			})).then(function (oData) {
				var mByRequester = {};

				(oData.leaveToApprove || []).forEach(function (oLeave) {
					var oGroup = mByRequester[oLeave.RequesterID];
					if (!oGroup) {
						oGroup = mByRequester[oLeave.RequesterID] = {
							RequesterID: oLeave.RequesterID,
							RequesterName: oLeave.RequesterName,
							RequesterEmail: oLeave.RequesterEmail,
							LeaveType: oLeave.LeaveType,
							initials: formatter.nameInitials(oLeave.RequesterName),
							LeaveList: []
						};
					}
					oGroup.LeaveList.push(oLeave);
				});

				oModel.setProperty("/approvals", Object.keys(mByRequester).map(function (sKey) {
					var oGroup = mByRequester[sKey];
					var aDates = oGroup.LeaveList.map(function (oLeave) {
						return oLeave.Date;
					}).sort();

					oGroup.title = oGroup.RequesterName + " — " + oGroup.LeaveType;
					oGroup.range = formatter.dateRange(aDates[0], aDates[aDates.length - 1]);
					oGroup.daysText = this.getText("homeDaysCount", [this._leaveDays(oGroup.LeaveList)]);
					oGroup.meta = oGroup.range + " · " + oGroup.daysText;

					// The design's row: "14 – 15 Jul 2026", "Holiday · Full day", "2 days"
					var fDays = this._leaveDays(oGroup.LeaveList);
					oGroup.rangeLabel = this._shortRange(aDates[0], aDates[aDates.length - 1]);
					oGroup.durationLabel = this._durationLabel(oGroup.LeaveList);
					oGroup.typeLabel = oGroup.LeaveType + " · " + oGroup.durationLabel;
					oGroup.daysLabel = this.getText(fDays === 1 ? "homeDay" : "homeDays", [fDays]);
					return oGroup;
				}, this));

				oModel.setProperty("/loadingApprovals", false);
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/approvals", []);
				oModel.setProperty("/loadingApprovals", false);
				this._showError("homeErrorApprovals", oError);
			}.bind(this));
		},

		/* =========================================================== */
		/* manager dashboard                                           */
		/* =========================================================== */

		/**
		 * Fills the manager dashboard. Each tile loads on its own, so one service
		 * being down (or not bound yet) leaves the others standing.
		 * @returns {Promise} resolved once every tile has settled
		 */
		_loadDashboard: function () {
			if (!this._oProfile || !this._oProfile.isManager) {
				return Promise.resolve();
			}
			var oToday = new Date();
			this._oDashYear = SicknessPolicy.fiscalYearOf(oToday);
			this._pDashPeople = HrxTime.people().then(function (aPeople) {
				return aPeople.filter(function (oPerson) {
					return oPerson.IsActive;
				});
			});
			this._pDashPeople.catch(function () {});

			return Promise.all([
				this._loadTeamToday(),
				this._loadCompliance(),
				this._loadTriggers(),
				this._loadDocsAwaiting(),
				this._loadUtilisation()
			]);
		},

		/**
		 * Who is in today, and who is off: approved leave, their own non-working days
		 * and bank holidays at their site.
		 * @returns {Promise} resolved once the team card is filled
		 */
		_loadTeamToday: function () {
			if (!this._pDashPeople) {
				return Promise.resolve();
			}
			var oModel = this.getModel();
			var oToday = new Date();
			var sToday = Backend.isoDate(oToday);
			var iWeekday = oToday.getDay();
			var aFlags = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

			oModel.setProperty("/dash/loadingTeam", true);
			// The design writes the day as "Monday, 13 July 2026": en-GB leaves out the comma.
			var sWeekday = oToday.toLocaleDateString("en-GB", { weekday: "long" });
			var sDate = oToday.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
			oModel.setProperty("/dash/todayLabel", sWeekday + ", " + sDate);

			return Promise.all([
				this._pDashPeople,
				HrxTime.leaves(sToday, sToday),
				Hrx.list("LeaveType"),
				Hrx.list("Sites"),
				Hrx.list("WorkSchedule"),
				Hrx.list("BankHolidays", { $filter: "Date eq " + sToday, $select: "Date,Site_ID" })
			]).then(function (aResults) {
				var mTypes = {};
				var mSites = {};
				var mSchedules = {};
				var mHolidays = {};
				var mLeave = {};

				aResults[2].forEach(function (oType) {
					mTypes[oType.ID] = oType.LeaveCategoryDesc || "";
				});
				aResults[3].forEach(function (oSite) {
					mSites[oSite.ID] = oSite.SiteDesc || oSite.SiteLocation || oSite.ID;
				});
				aResults[4].forEach(function (oSchedule) {
					mSchedules[oSchedule.EmployeeID_EmployeeID] = oSchedule;
				});
				aResults[5].forEach(function (oHoliday) {
					mHolidays[oHoliday.Site_ID || "*"] = true;
				});
				aResults[1].filter(function (oLeave) {
					return HrxLegacy.leaveStatus(oLeave) === "APR";
				}).forEach(function (oLeave) {
					var bHalf = /^(AM|PM)$/i.test(String(oLeave.DayTime || "").trim());
					mLeave[oLeave.EmpID_EmployeeID] = (mTypes[oLeave.LeaveCategoryId_ID] || this.getText("mgrLeave")) +
						(bHalf ? " (" + String(oLeave.DayTime).trim().toUpperCase() + ")" : "");
				}, this);

				var mBySite = {};
				var iWorking = 0;
				var iOnLeave = 0;

				var aRows = aResults[0].map(function (oPerson) {
					var oSchedule = mSchedules[oPerson.EmpID];
					var bWorkDay = oSchedule ? oSchedule[aFlags[iWeekday]] === true : iWeekday >= 1 && iWeekday <= 5;
					var sSite = mSites[oPerson.SiteID] || oPerson.SiteID || "—";
					var oRow = {
						EmpID: oPerson.EmpID,
						Name: oPerson.Name,
						LastName: oPerson.LastName,
						initials: formatter.nameInitials(oPerson.Name),
						site: sSite,
						order: 2
					};

					if (mLeave[oPerson.EmpID]) {
						oRow.statusText = this.getText("mgrOnLeave", [mLeave[oPerson.EmpID]]);
						oRow.statusState = "Information";
						oRow.order = 0;
						iOnLeave++;
					} else if (mHolidays[oPerson.SiteID] || mHolidays["*"]) {
						oRow.statusText = this.getText("mgrBankHoliday");
						oRow.statusState = "None";
						oRow.order = 1;
					} else if (!bWorkDay) {
						oRow.statusText = this.getText("mgrNotWorking");
						oRow.statusState = "None";
						oRow.order = 1;
					} else {
						oRow.statusText = this.getText("mgrWorking");
						oRow.statusState = "Success";
						iWorking++;
						mBySite[sSite] = (mBySite[sSite] || 0) + 1;
					}
					return oRow;
				}, this).sort(function (a, b) {
					return (a.order - b.order) || String(a.LastName).localeCompare(String(b.LastName)) ||
						a.Name.localeCompare(b.Name);
				});

				// Busiest site first, as the design's "24 Oswestry · 16 Aurangabad"
				var aParts = Object.keys(mBySite).sort(function (a, b) {
					return mBySite[b] - mBySite[a] || a.localeCompare(b);
				}).map(function (sSite) {
					return mBySite[sSite] + " " + sSite;
				});
				aParts.push(this.getText("mgrOnLeaveCount", [iOnLeave]));

				oModel.setProperty("/dash/today", aRows);
				oModel.setProperty("/dash/team", {
					working: String(iWorking),
					unit: this.getText("mgrOf", [aRows.length]),
					sub: aParts.join(" · ")
				});
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/dash/today", []);
				oModel.setProperty("/dash/team", this._dashUnavailable());
				console.error("Home team today failed", oError);
			}.bind(this)).then(function () {
				oModel.setProperty("/dash/loadingTeam", false);
			});
		},

		/**
		 * This week's timesheet compliance, worked out as Timesheet Reporting's Who's
		 * submitted tab does: the share of people with time due who have booked it all.
		 * @returns {Promise} resolved once the tile is filled
		 */
		_loadCompliance: function () {
			var oModel = this.getModel();
			var oMonday = this._mondayOf(new Date());
			var oSunday = new Date(oMonday.getFullYear(), oMonday.getMonth(), oMonday.getDate() + 6);

			oModel.setProperty("/dash/loadingCompliance", true);
			return TimesheetReportService.loadWeek(Backend.isoDate(oMonday), Backend.isoDate(oSunday)).then(function (aRows) {
				var aDue = aRows.filter(function (oRow) {
					return oRow.expectedMinutes > 0;
				});
				var iFull = aDue.filter(function (oRow) {
					return oRow.bookedMinutes >= oRow.expectedMinutes;
				}).length;
				var iPct = aDue.length ? Math.round(iFull / aDue.length * 100) : 100;

				oModel.setProperty("/dash/compliance", {
					pct: String(iPct),
					state: iPct >= 90 ? "Good" : "Warning",
					sub: this.getText("mgrComplianceSub", [iFull, aDue.length])
				});
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/dash/compliance", this._dashUnavailable());
				console.error("Home compliance failed", oError);
			}.bind(this)).then(function () {
				oModel.setProperty("/dash/loadingCompliance", false);
			});
		},

		/**
		 * Open sickness policy triggers this financial year. Dismissals live in the
		 * trigger review service, which is not bound yet - until it is, every trigger
		 * counts as open, as it does on the Sickness page.
		 * @returns {Promise} resolved once the tile is filled
		 */
		_loadTriggers: function () {
			var oModel = this.getModel();
			var oYear = this._oDashYear;

			oModel.setProperty("/dash/loadingTriggers", true);
			return Promise.all([
				SicknessService.getAbsences(this._sOrgId, oYear.from, oYear.to),
				SicknessService.getTriggerReviews(this._sOrgId, oYear.startYear).catch(function () {
					return [];
				})
			]).then(function (aResults) {
				var iOpen = SicknessPolicy.triggers(aResults[0], oYear, aResults[1]).filter(function (oTrigger) {
					return oTrigger.status === "OPEN";
				}).length;

				oModel.setProperty("/dash/triggers", {
					count: String(iOpen),
					state: iOpen > 0 ? "Critical" : "Good",
					sub: this.getText("mgrTriggersSub", [oYear.label])
				});
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/dash/triggers", this._dashUnavailable());
				console.error("Home triggers failed", oError);
			}.bind(this)).then(function () {
				oModel.setProperty("/dash/loadingTriggers", false);
			});
		},

		/**
		 * Acknowledgements still outstanding across every document that needs one.
		 * Empty until the document service is bound.
		 * @returns {Promise} resolved once the tile is filled
		 */
		_loadDocsAwaiting: function () {
			var oModel = this.getModel();

			if (!DocumentService.isBound()) {
				oModel.setProperty("/dash/docs", {
					count: "—",
					state: "Neutral",
					sub: this.getText("mgrNotConnected")
				});
				return Promise.resolve();
			}

			oModel.setProperty("/dash/loadingDocs", true);
			return Promise.all([
				DocumentService.getDocuments(this._sOrgId),
				DocumentService.getAcknowledgements(this._sOrgId),
				this._pDashPeople
			]).then(function (aResults) {
				var mAcks = Documents.ackIndex(aResults[1]);
				var iOutstanding = (aResults[0] || []).filter(function (oDocument) {
					return oDocument.AckRequired;
				}).reduce(function (iTotal, oDocument) {
					return iTotal + Documents.progress(oDocument, aResults[2], mAcks).outstanding.length;
				}, 0);

				oModel.setProperty("/dash/docs", {
					count: String(iOutstanding),
					state: iOutstanding > 0 ? "Warning" : "Good",
					sub: this.getText("mgrDocsSub")
				});
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/dash/docs", this._dashUnavailable());
				console.error("Home documents failed", oError);
			}.bind(this)).then(function () {
				oModel.setProperty("/dash/loadingDocs", false);
			});
		},

		/**
		 * Billable utilisation for the financial year to date: the team figure, and a
		 * bar per person, lowest first so the ones to look at come to the top.
		 * @returns {Promise} resolved once the card is filled
		 */
		_loadUtilisation: function () {
			var oModel = this.getModel();
			var oPeriod = { from: this._oDashYear.from, to: Backend.isoDate(new Date()) };

			oModel.setProperty("/dash/loadingUtil", true);
			return this._pDashPeople.then(function (aPeople) {
				return TimesheetReportService.loadBookings(aPeople, this._sOrgId, oPeriod.from, oPeriod.to);
			}.bind(this)).then(function (oResult) {
				var aPeople = TimesheetReport.utilisation(oResult.bookings, oPeriod);
				var fBillable = 0;
				var fTotal = 0;
				var iBillers = 0;

				var aRows = aPeople.map(function (oPerson) {
					fBillable += oPerson.billable;
					fTotal += oPerson.total;
					if (oPerson.billable > 0) {
						iBillers++;
					}
					var sState = TimesheetReport.utilState(oPerson.pct);
					return {
						Name: oPerson.Name,
						pct: oPerson.pct,
						pctText: oPerson.pct + "%",
						sub: this.getText("mgrUtilRowSub", [this._days(oPerson.billable), this._days(oPerson.total)]),
						// The bar (a ProgressIndicator) takes 0 to 100 and one of its own states
						barPct: Math.max(0, Math.min(100, oPerson.pct)),
						state: sState
					};
				}, this).sort(function (a, b) {
					return (a.pct - b.pct) || a.Name.localeCompare(b.Name);
				});

				oModel.setProperty("/dash/util", {
					pctText: fTotal ? Math.round(fBillable / fTotal * 100) + "%" : "—",
					cap: aRows.length ? this.getText("mgrUtilCap", [iBillers, aRows.length]) : "",
					rows: aRows
				});
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/dash/util", { pctText: "—", cap: this.getText("mgrUnavailable"), rows: [] });
				console.error("Home utilisation failed", oError);
			}.bind(this)).then(function () {
				oModel.setProperty("/dash/loadingUtil", false);
			});
		},

		_days: function (fDays) {
			return (Math.round(fDays * 10) / 10).toFixed(1);
		},

		_dashUnavailable: function () {
			return { working: "—", count: "—", pct: "—", unit: "", state: "Neutral", sub: this.getText("mgrUnavailable") };
		},

		/**
		 * The dashboard's links. "route:tab" opens Timesheet Reporting on a tab.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onDashGo: function (oEvent) {
			var aGo = String(oEvent.getSource().data("go")).split(":");
			var oRouter = this.getOwnerComponent().getRouter();
			if (aGo[1]) {
				oRouter.navTo(aGo[0], { "?query": { tab: aGo[1] } });
			} else {
				oRouter.navTo(aGo[0]);
			}
		},

		/**
		 * Whether a request is for whole days, half days or both.
		 * @param {Array<object>} aLeaveList pendingApproval rows, one per day
		 * @returns {string} "Full day", "Half day" or "Full and half days"
		 */
		_durationLabel: function (aLeaveList) {
			var iHalf = aLeaveList.filter(function (oLeave) {
				return /^(AM|PM)$/i.test(String(oLeave.AbsenceType || ""));
			}).length;
			if (!iHalf) {
				return this.getText("homeFullDay");
			}
			return this.getText(iHalf === aLeaveList.length ? "homeHalfDay" : "homeMixedDays");
		},

		/**
		 * A date range as the design writes it: "14 – 15 Jul 2026",
		 * "29 Aug – 2 Sep 2026", or a single "14 Jul 2026".
		 * @param {string|Date} vFrom the first day
		 * @param {string|Date} vTo the last day
		 * @returns {string} the range
		 */
		_shortRange: function (vFrom, vTo) {
			var oFrom = formatter.toDate(vFrom);
			var oTo = formatter.toDate(vTo) || oFrom;
			if (!oFrom) {
				return "";
			}
			var fnFull = function (oDate) {
				return oDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
			};
			if (Backend.isoDate(oFrom) === Backend.isoDate(oTo)) {
				return fnFull(oFrom);
			}
			var sFrom;
			if (oFrom.getFullYear() !== oTo.getFullYear()) {
				sFrom = fnFull(oFrom);
			} else if (oFrom.getMonth() !== oTo.getMonth()) {
				sFrom = oFrom.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
			} else {
				sFrom = String(oFrom.getDate());
			}
			return sFrom + " – " + fnFull(oTo);
		},

		/**
		 * Working days in a list of pending leave days, a half day counting as half.
		 * @param {Array<object>} aLeaveList pendingApproval rows, one per day
		 * @returns {number} the days
		 */
		_leaveDays: function (aLeaveList) {
			return aLeaveList.reduce(function (fTotal, oLeave) {
				return fTotal + (/^(AM|PM)$/i.test(String(oLeave.AbsenceType || "")) ? 0.5 : 1);
			}, 0);
		},

		/* =========================================================== */
		/* quick timesheet                                             */
		/* =========================================================== */

		/**
		 * The "Today" link in the Quick Timesheet header: opens the date picker on the
		 * day being booked, to book another day instead.
		 * @param {sap.ui.base.Event} oEvent the link press event
		 */
		onOpenQuickDayCalendar: function (oEvent) {
			var oDay = formatter.toDate(this.getModel().getProperty("/quick/day")) || new Date();
			this._openCalendar("day", oEvent.getSource(), oDay);
		},

		/**
		 * A day picked for Quick Timesheet: the card loads what that day holds.
		 * @param {Date} oDay the day picked
		 */
		_applyQuickDay: function (oDay) {
			var oModel = this.getModel();
			oModel.setProperty("/quick/day", Backend.isoDate(oDay));
			oModel.setProperty("/quick/hours", "");
			oModel.setProperty("/quick/comment", "");
			oModel.setProperty("/quick/ProjectID", "");
			this.byId("qtHours").setValueState("None");
			this._loadDay();
		},

		/**
		 * Normalises whatever was typed into hh:mm as soon as the field is left, the same
		 * way the Timesheet grid does.
		 * @param {sap.ui.base.Event} oEvent the input change event
		 */
		onQuickHoursChange: function (oEvent) {
			var oInput = oEvent.getSource();
			var sValue = (oInput.getValue() || "").trim();
			var sNormalised = this._normaliseTime(sValue);

			if (sValue && sNormalised === null) {
				oInput.setValueState("Error");
				oInput.setValueStateText(this.getText("tsInvalidTime"));
				return;
			}

			oInput.setValueState("None");
			this.getModel().setProperty("/quick/hours", sNormalised || "");
		},

		/**
		 * Returns to the entry form so more time can be booked against the same day.
		 */
		onLogMoreTime: function () {
			this.getModel().setProperty("/quick/logged", false);
		},

		/**
		 * Books the time against the chosen day. Re-booking a project that already has an
		 * entry that day updates it rather than adding a second one.
		 */
		onSaveQuickTimesheet: function () {
			var oModel = this.getModel();
			var oQuick = oModel.getProperty("/quick");
			var sHours = this._normaliseTime((oQuick.hours || "").trim());

			if (!oQuick.day) {
				MessageToast.show(this.getText("homeNeedDay"));
				return;
			}
			if (!oQuick.dayEditable) {
				MessageToast.show(oQuick.dayEditableReason || this.getText("qtNonWorkingDay"));
				return;
			}
			if (!oQuick.ProjectID) {
				MessageToast.show(this.getText("homeNeedProject"));
				return;
			}
			if (!sHours || sHours === "00:00") {
				this.byId("qtHours").setValueState("Error");
				this.byId("qtHours").setValueStateText(this.getText("tsInvalidTime"));
				MessageToast.show(this.getText("homeNeedHours"));
				return;
			}
			if (!(oQuick.comment || "").trim()) {
				MessageToast.show(this.getText("homeNeedComment"));
				return;
			}

			this.byId("qtHours").setValueState("None");

			var oExisting = (oQuick.entries || []).filter(function (oEntry) {
				return oEntry.ProjectID === oQuick.ProjectID;
			})[0];
			var oNow = new Date();

			oModel.setProperty("/loadingDay", true);

			Backend.postJson(Backend.TIMESHEET + "?cmd=save", {
				OrgID: this._sOrgId,
				UserID: this._sUserId,
				SavedOn: Backend.isoDate(oNow),
				SavedAt: Backend.clockTime(oNow),
				SavedBy: this._sUserId,
				TimesheetListSet: [{
					RecID: (oExisting && oExisting.recId) || "",
					ProjectKey: oQuick.ProjectID,
					Date: oQuick.day,
					Hours: sHours + ":00",
					Comment: oQuick.comment.trim()
				}]
			}).then(function (oResult) {
				MessageToast.show(oResult.msg || this.getText("tsSaved"));
				oModel.setProperty("/quick/hours", "");
				oModel.setProperty("/quick/comment", "");
				return Promise.all([this._loadDay(), this._loadWeek()]);
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/loadingDay", false);
				this._showError("tsErrorSave", oError);
			}.bind(this));
		},

		/* =========================================================== */
		/* quick leave                                                 */
		/* =========================================================== */

		/**
		 * The Dates field of Quick Leave: opens the date picker for a range.
		 * @param {sap.ui.base.Event} oEvent the value help request of the field
		 */
		onOpenQuickLeaveCalendar: function (oEvent) {
			this._openCalendar("range", oEvent.getSource(), null);
		},

		/**
		 * Asks the service which of the chosen days can actually be booked - weekends,
		 * bank holidays and days already taken are left out.
		 * @param {Date} oFrom the first day picked
		 * @param {Date} oTo the last day picked
		 */
		_applyQuickLeaveRange: function (oFrom, oTo) {
			var oModel = this.getModel();
			var oUser = oModel.getProperty("/user") || {};
			var sRange = this._ordinalRange(oFrom, oTo);

			this.byId("qlDates").setValueState("None");
			oModel.setProperty("/quickLeave/rangeBase", sRange);
			oModel.setProperty("/quickLeave/rangeText", sRange);
			oModel.setProperty("/quickLeave/dates", []);
			oModel.setProperty("/quickLeave/NoOfDays", 0);

			Backend.getJson(Backend.query(Backend.LEAVE, {
				cmd: "getDates",
				FromDate: Backend.isoDate(oFrom),
				ToDate: Backend.isoDate(oTo),
				OrgID: this._sOrgId,
				SiteID: oUser.siteID || "",
				EmpID: oUser.empID || ""
			})).then(function (oData) {
				oModel.setProperty("/quickLeave/dates", oData.dates || []);
				this._updateLeaveDayCount();
			}.bind(this)).catch(function (oError) {
				oModel.setProperty("/quickLeave/dates", []);
				oModel.setProperty("/quickLeave/NoOfDays", 0);
				this._showError("mlErrorDates", oError);
			}.bind(this));
		},

		/**
		 * A range as the design's picker writes it: "16th – 20th July 2026",
		 * "30th July – 3rd August 2026", or a single "16th July 2026".
		 * @param {Date} oFrom the first day
		 * @param {Date} oTo the last day
		 * @returns {string} the range
		 */
		_ordinalRange: function (oFrom, oTo) {
			var fnDay = function (oDate) {
				return this._ordinal(oDate.getDate());
			}.bind(this);
			var fnMonth = function (oDate) {
				return oDate.toLocaleDateString("en-GB", { month: "long" });
			};
			var bSameYear = oFrom.getFullYear() === oTo.getFullYear();
			var bSameMonth = bSameYear && oFrom.getMonth() === oTo.getMonth();

			if (Backend.isoDate(oFrom) === Backend.isoDate(oTo)) {
				return fnDay(oFrom) + " " + fnMonth(oFrom) + " " + oFrom.getFullYear();
			}
			if (bSameMonth) {
				return fnDay(oFrom) + " - " + fnDay(oTo) + " " + fnMonth(oFrom) + " " + oFrom.getFullYear();
			}
			if (bSameYear) {
				return fnDay(oFrom) + " " + fnMonth(oFrom) + " - " + fnDay(oTo) + " " + fnMonth(oTo) + " " +
					oFrom.getFullYear();
			}
			return fnDay(oFrom) + " " + fnMonth(oFrom) + " " + oFrom.getFullYear() + " - " +
				fnDay(oTo) + " " + fnMonth(oTo) + " " + oTo.getFullYear();
		},

		/**
		 * @param {number} iDay a day of the month
		 * @returns {string} the day with its suffix: 1st, 2nd, 3rd, 4th, 11th, 22nd
		 */
		_ordinal: function (iDay) {
			var iTens = iDay % 100;
			if (iTens >= 11 && iTens <= 13) {
				return iDay + "th";
			}
			return iDay + ({ 1: "st", 2: "nd", 3: "rd" }[iDay % 10] || "th");
		},

		/* =========================================================== */
		/* date picker (fragment/HomeDatePopover)                      */
		/* =========================================================== */

		/**
		 * Opens the design's date picker under a field.
		 * @param {string} sMode "range" for Quick Leave, "day" for Quick Timesheet
		 * @param {sap.ui.core.Control} oOpener the control the picker opens under
		 * @param {Date|null} oSelected the day already chosen, in "day" mode
		 */
		_openCalendar: function (sMode, oOpener, oSelected) {
			var oToday = new Date();
			var oShown = oSelected || oToday;

			this._oCal = {
				mode: sMode,
				month: new Date(oShown.getFullYear(), oShown.getMonth(), 1),
				start: sMode === "day" ? oSelected : null,
				end: sMode === "day" ? oSelected : null
			};
			this.getModel().setProperty("/cal/foot", this.getText(sMode === "day" ? "homeDpDay" : "homeDpStart"));
			this._renderCalendar();

			this._getDatePopover().then(function (oPopover) {
				// A Bottom popover hangs from its opener's left edge, as the design's does
				// from the Dates field; by the "Today" link it is kept inside the window.
				oPopover.openBy(oOpener);
			});
		},

		/**
		 * @returns {Promise<sap.m.Popover>} the date picker, loaded on first use
		 */
		_getDatePopover: function () {
			if (!this._pDatePopover) {
				this._pDatePopover = this.loadFragment({
					name: "bsx.hrx.hrx2026.fragment.HomeDatePopover"
				});
			}
			return this._pDatePopover;
		},

		onCalendarPrevMonth: function () {
			this._oCal.month.setMonth(this._oCal.month.getMonth() - 1);
			this._renderCalendar();
		},

		onCalendarNextMonth: function () {
			this._oCal.month.setMonth(this._oCal.month.getMonth() + 1);
			this._renderCalendar();
		},

		/**
		 * A day pressed in the picker. In "day" mode that is the choice. In "range"
		 * mode the first press is the start, the second the end (either way round).
		 * @param {sap.ui.base.Event} oEvent the day button press event
		 */
		onCalendarDayPress: function (oEvent) {
			var oCal = this._oCal;
			var oDay = formatter.toDate(oEvent.getSource().getBindingContext("home").getProperty("date"));
			var oModel = this.getModel();

			if (oCal.mode === "day") {
				oCal.start = oCal.end = oDay;
				this._renderCalendar();
				this._closeCalendarSoon();
				this._applyQuickDay(oDay);
				return;
			}

			if (!oCal.start || oCal.end) {
				oCal.start = oDay;
				oCal.end = null;
				oModel.setProperty("/cal/foot", this.getText("homeDpEnd"));
				this._renderCalendar();
				return;
			}

			if (oDay < oCal.start) {
				oCal.end = oCal.start;
				oCal.start = oDay;
			} else {
				oCal.end = oDay;
			}
			this._renderCalendar();
			this._closeCalendarSoon();
			this._applyQuickLeaveRange(oCal.start, oCal.end);
		},

		/**
		 * Closes the picker a moment after the pick, so the chosen days show first -
		 * as the design does.
		 */
		_closeCalendarSoon: function () {
			this._getDatePopover().then(function (oPopover) {
				setTimeout(function () {
					oPopover.close();
				}, 150);
			});
		},

		/**
		 * Fills home>/cal with the month on show: six weeks from the Monday on or
		 * before the 1st, each day marked as outside the month, before today (no
		 * leave can be booked in the past) and where it sits in the range picked.
		 */
		_renderCalendar: function () {
			var oCal = this._oCal;
			var oModel = this.getModel();
			var oMonth = oCal.month;
			var sToday = Backend.isoDate(new Date());
			var sStart = oCal.start ? Backend.isoDate(oCal.start) : "";
			var sEnd = oCal.end ? Backend.isoDate(oCal.end) : "";
			var oFirst = this._mondayOf(oMonth);
			var aDays = [];

			for (var i = 0; i < 42; i++) {
				var oDate = new Date(oFirst.getFullYear(), oFirst.getMonth(), oFirst.getDate() + i);
				var sDate = Backend.isoDate(oDate);
				var bPast = oCal.mode === "range" && sDate < sToday;
				var sRange = "none";

				if (sDate === sStart && sDate === sEnd) {
					sRange = "single";
				} else if (sDate === sStart) {
					sRange = sEnd ? "start" : "single";
				} else if (sDate === sEnd) {
					sRange = "end";
				} else if (sStart && sEnd && sDate > sStart && sDate < sEnd) {
					sRange = "in";
				}

				aDays.push({
					date: sDate,
					text: String(oDate.getDate()),
					muted: oDate.getMonth() !== oMonth.getMonth(),
					enabled: !bPast,
					range: sRange,
					tooltip: bPast ? this.getText("homeDpPast") : ""
				});
			}

			oModel.setProperty("/cal/title", oMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" }));
			oModel.setProperty("/cal/days", aDays);
		},

		onQuickLeaveDurationChange: function () {
			this._updateLeaveDayCount();
		},

		/**
		 * Half days count as half a day towards the request.
		 */
		_updateLeaveDayCount: function () {
			var oModel = this.getModel();
			var aDates = oModel.getProperty("/quickLeave/dates") || [];
			var bHalf = oModel.getProperty("/quickLeave/DayTime") !== "Full Day";

			var fDays = aDates.reduce(function (fTotal, oDay) {
				// A day with only one free half can never be taken as a whole one.
				return fTotal + (bHalf || oDay.availableSlot ? 0.5 : 1);
			}, 0);
			oModel.setProperty("/quickLeave/NoOfDays", fDays);

			// The field shows the range picked and how many days of it are bookable
			// (weekends, bank holidays and days already taken drop out).
			var sRange = oModel.getProperty("/quickLeave/rangeBase");
			if (sRange) {
				oModel.setProperty("/quickLeave/rangeText", this.getText("homeRangeDays", [
					sRange, this.getText(fDays === 1 ? "homeDay" : "homeDays", [fDays])
				]));
			}
		},

		/**
		 * Submits the request to the user's manager for approval.
		 */
		onRequestLeave: function () {
			var oModel = this.getModel();
			var oForm = oModel.getProperty("/quickLeave");
			var oUser = oModel.getProperty("/user") || {};
			var aDates = oForm.dates || [];

			// The design's button is always live and says what is missing
			if (!oForm.rangeText) {
				this.byId("qlDates").setValueState("Error");
				this.byId("qlDates").setValueStateText(this.getText("homeNeedDates"));
				MessageToast.show(this.getText("homeNeedDates"));
				return;
			}
			if (!aDates.length) {
				MessageToast.show(this.getText("mlNoBookableDays"));
				return;
			}
			if (parseFloat(oForm.NoOfDays) > parseFloat(oUser.balanceLeaves || 0) && oForm.LeaveCategoryId === "HOLIL") {
				MessageBox.warning(this.getText("mlWarnOverBalance", [oForm.NoOfDays, oUser.balanceLeaves]));
			}

			var sToday = Backend.isoDate(new Date());

			var aRequests = aDates.map(function (oDay) {
				// A day with one half already taken can only take the other half.
				var sDayTime = oDay.availableSlot || oForm.DayTime;

				return {
					OrgID: this._sOrgId,
					LeaveID: "",
					EmpID: oUser.empID,
					EmpName: oUser.name,
					EmpEmail: this._sUserEmail,
					EmpSite: oUser.siteID || "",
					IsPaid: oForm.LeaveCategoryId === "UNPDL" ? "N" : "Y",
					LeaveCategoryId: oForm.LeaveCategoryId,
					NoOfDays: "1",
					StartDate: oDay.date,
					EndDate: oDay.date,
					DayTime: sDayTime,
					CreatedBy: oUser.empID,
					CreatedOn: sToday,
					ApprovalRequired: "Y",
					ApproverID: oUser.managerID || "",
					ApproverName: oUser.managerName || "",
					ApproverEmail: oUser.managerEmail || "",
					Status: "REQ",
					ApprovedOn: "",
					ApprovedBy: "",
					RequesterComments: oForm.Comments || "",
					ApproverComments: ""
				};
			}, this);

			oModel.setProperty("/savingLeave", true);

			Backend.postJson(Backend.LEAVE + "?cmd=requestLeave", { LeaveReqSet: aRequests })
				.then(function (oResult) {
					MessageToast.show(oResult.msg || this.getText("mlRequested"));
					oModel.setProperty("/savingLeave", false);
					oModel.setProperty("/quickLeave", this._emptyQuickLeave());
					return this._loadLeaveUser();
				}.bind(this)).catch(function (oError) {
					oModel.setProperty("/savingLeave", false);
					this._showError("mlErrorRequest", oError);
				}.bind(this));
		},

		/* =========================================================== */
		/* approvals                                                   */
		/* =========================================================== */

		onApproveLeave: function (oEvent) {
			this._actionLeave(oEvent, "APR");
		},

		/**
		 * Asks for an optional note to the employee before turning the request down.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onRejectLeave: function (oEvent) {
			var oContext = oEvent.getSource().getBindingContext("home");
			if (!oContext) {
				return;
			}
			var oGroup = oContext.getObject();
			var oNote = new TextArea({
				width: "100%",
				rows: 3,
				maxLength: 500,
				placeholder: this.getText("mgrDeclineNotePlaceholder")
			});
			// The design's decline modal (hrxModal, shared in style.css): who, when
			// and what, an optional note, Reject (danger) then Cancel.
			var oDialog = new Dialog({
				title: this.getText("mgrDeclineTitle"),
				content: new VBox({
					items: [
						// The design: "Sam Evans · 14 – 15 Jul 2026 · Holiday (Full day)"
						new Text({
							text: oGroup.RequesterName + " · " + oGroup.rangeLabel + " · " +
								oGroup.LeaveType + " (" + oGroup.durationLabel + ")"
						}).addStyleClass("hrxModalText"),
						new Label({ text: this.getText("mgrDeclineNote"), labelFor: oNote }).addStyleClass("hrxModalLabel"),
						oNote
					]
				}),
				beginButton: new Button({
					text: this.getText("btnReject"),
					press: function () {
						var sNote = oNote.getValue().trim();
						oDialog.close();
						this._actionLeave(oGroup, "REJ", sNote);
					}.bind(this)
				}).addStyleClass("hrxModalBtn hrxModalBtnDanger"),
				endButton: new Button({
					text: this.getText("dmCancel"),
					press: function () {
						oDialog.close();
					}
				}).addStyleClass("hrxModalBtn hrxModalBtnGhost"),
				afterClose: function () {
					oDialog.destroy();
				}
			}).addStyleClass("hrxModal hrxHomeDeclineModal");
			this.getView().addDependent(oDialog);
			oDialog.open();
		},

		/**
		 * Decides every pending day of one requester in a single call.
		 * @param {sap.ui.base.Event|object} vSource the button press event, or the
		 * requester's group itself
		 * @param {string} sStatus "APR" or "REJ"
		 * @param {string} [sNote] the approver's note to the employee
		 */
		_actionLeave: function (vSource, sStatus, sNote) {
			var oGroup = vSource;
			if (vSource && typeof vSource.getSource === "function") {
				var oContext = vSource.getSource().getBindingContext("home");
				if (!oContext) {
					return;
				}
				oGroup = oContext.getObject();
			}
			var sToday = Backend.isoDate(new Date());
			var oModel = this.getModel();

			var aLeaveRequests = oGroup.LeaveList.map(function (oLeave) {
				return {
					LeaveID: oLeave.LeaveID,
					RequesterID: oGroup.RequesterID,
					RequesterName: oGroup.RequesterName,
					RequesterEmail: oGroup.RequesterEmail,
					Status: sStatus,
					OrgID: this._sOrgId,
					ApprovedOn: sToday,
					ApprovedBy: this._oProfile.empID,
					ApproverName: this._oProfile.name,
					ApproverEmail: this._sUserEmail,
					ApproverComments: sNote || ""
				};
			}, this);

			oModel.setProperty("/loadingApprovals", true);

			Backend.postJson(Backend.LEAVE_APPROVALS + "?cmd=action", { LeaveReqSet: aLeaveRequests })
				.then(function () {
					MessageToast.show(this.getText(sStatus === "APR" ? "mgrApprovedToast" : "mgrDeclinedToast",
						[oGroup.RequesterName]));
					this._loadTeamToday();
					return this._loadApprovals();
				}.bind(this)).catch(function (oError) {
					oModel.setProperty("/loadingApprovals", false);
					this._showError("tcErrorApprovalAction", oError);
				}.bind(this));
		},

		/* =========================================================== */
		/* formatters                                                  */
		/* =========================================================== */

		formatPendingCount: function (aApprovals) {
			return this.getText("approvalsPending", [(aApprovals || []).length]);
		},

		formatLoggedTitle: function (sTotal) {
			return this.getText("qtLogged", [sTotal || "0:00"]);
		},

		/* =========================================================== */
		/* helpers                                                     */
		/* =========================================================== */

		getModel: function () {
			return this.getView().getModel("home");
		},

		getResourceBundle: function () {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle();
		},

		getText: function (sKey, aArgs) {
			return this.getResourceBundle().getText(sKey, aArgs);
		},

		_dayLabel: function (oDate) {
			var sToday = Backend.isoDate(new Date());
			if (Backend.isoDate(oDate) === sToday) {
				return this.getText("today");
			}
			return oDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
		},

		/**
		 * @param {Date} oDate a day
		 * @returns {string} the day as the design writes it under "Logged for today":
		 * "Monday, 19th October"
		 */
		_longDayLabel: function (oDate) {
			var sWeekday = oDate.toLocaleDateString("en-GB", { weekday: "long" });
			var sMonth = oDate.toLocaleDateString("en-GB", { month: "long" });
			return sWeekday + ", " + this._ordinal(oDate.getDate()) + " " + sMonth;
		},

		/**
		 * Accepts "7", "7:30", "7.5" or "730" and returns hh:mm.
		 * @param {string} sValue whatever was typed
		 * @returns {string|null} the normalised time, or null when it cannot be read
		 */
		_normaliseTime: function (sValue) {
			if (!sValue) {
				return "";
			}

			var aParts = /^(\d{1,2}):(\d{1,2})$/.exec(sValue);
			var iHours;
			var iMinutes;

			if (aParts) {
				iHours = parseInt(aParts[1], 10);
				iMinutes = parseInt(aParts[2], 10);
			} else if (/^\d{1,2}([.,]\d{1,2})?$/.test(sValue)) {
				var fValue = parseFloat(sValue.replace(",", "."));
				iHours = Math.floor(fValue);
				iMinutes = Math.round((fValue - iHours) * 60);
			} else if (/^\d{3,4}$/.test(sValue)) {
				iHours = parseInt(sValue.slice(0, sValue.length - 2), 10);
				iMinutes = parseInt(sValue.slice(-2), 10);
			} else {
				return null;
			}

			if (isNaN(iHours) || isNaN(iMinutes) || iMinutes > 59 || iHours > 24 || (iHours === 24 && iMinutes > 0)) {
				return null;
			}

			return String(iHours).padStart(2, "0") + ":" + String(iMinutes).padStart(2, "0");
		},

		/**
		 * Durations arrive either as hh:mm:ss or already as hh:mm, so only a third part
		 * may be dropped.
		 * @param {string} sHours a duration
		 * @returns {string} the duration as hh:mm
		 */
		_trimSeconds: function (sHours) {
			if (!sHours || sHours === "None") {
				return "";
			}
			var aParts = String(sHours).split(":");
			return aParts.length > 2 ? aParts[0] + ":" + aParts[1] : String(sHours);
		},

		_emptyQuickEntry: function () {
			return Object.assign({
				day: Backend.isoDate(new Date()),
				dayLabel: this.getText("today"),
				dayFullLabel: "",
				loggedTitle: "",
				loggedSub: "",
				projects: [],
				entries: [],
				bookedTotal: "0:00",
				logged: false,
				dayEditable: true,
				dayEditableReason: ""
			}, { ProjectID: "", hours: "", comment: "" });
		},

		_emptyQuickLeave: function () {
			return {
				LeaveCategoryId: "HOLIL",
				DayTime: "Full Day",
				rangeBase: "",
				rangeText: "",
				Comments: "",
				NoOfDays: 0,
				dates: []
			};
		},

		_emptyState: function () {
			return {
				loadingWeek: false,
				loadingDay: false,
				loadingApprovals: false,
				savingLeave: false,
				user: {},
				leaveTypes: [],
				projectTypes: [],
				approvals: [],
				dash: {
					today: [],
					todayLabel: "",
					team: { working: "", unit: "", sub: "" },
					compliance: { pct: "", state: "Neutral", sub: "" },
					triggers: { count: "", state: "Neutral", sub: "" },
					docs: { count: "", state: "Neutral", sub: "" },
					util: { pctText: "", cap: "", rows: [] }
				},
				quickLeave: this._emptyQuickLeave(),
				quick: this._emptyQuickEntry(),
				week: { label: "", status: { text: "", state: "None" } },
				weekRings: [],
				weekHasOverbooked: false,
				// The date picker: Mo to Su headings, then the month on show
				cal: {
					title: "",
					foot: "",
					weekdays: this.getText("homeDpWeekdays").split(",").map(function (sName) {
						return { name: sName };
					}),
					days: []
				}
			};
		},

		_errorText: function (oError) {
			if (!oError) {
				return "";
			}
			return oError.message || String(oError);
		},

		_showError: function (sTextKey, oError) {
			MessageBox.error(this.getText(sTextKey), {
				details: this._errorText(oError)
			});
		}
	});
});
