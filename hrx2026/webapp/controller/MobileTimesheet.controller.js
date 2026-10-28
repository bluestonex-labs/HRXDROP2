sap.ui.define([
	"./Timesheet.controller",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageToast",
	"../model/formatter",
	"../model/Toast"
], function (Timesheet, JSONModel, MessageToast, formatter, Toast) {
	"use strict";

	// The stepper moves a day's time by half an hour, between nothing and a full day
	// and night - the same ceiling _normaliseTime puts on a typed time.
	var STEP_MINUTES = 30;
	var MAX_MINUTES = 24 * 60;

	// The quick-pick buttons under the stepper, in minutes (0 clears the day).
	var QUICK_MINUTES = [60, 120, 240, 480];

	// The save bar's pill for each auto-save state (Timesheet._setAutoSaveStatus).
	var AUTO_SAVE_PILL = { saving: "info", saved: "ok", waiting: "warn", error: "crit" };

	// A day's state, as the mobile design colours it: the dot under each day chip, the
	// pill on the day card and the rings on the phone's Home.
	var STATUS = {
		complete: { pill: "ok", textKey: "mbStatusComplete" },
		partial: { pill: "warn", textKey: "mbStatusPartial" },
		missing: { pill: "crit", textKey: "mbStatusMissing" },
		leave: { pill: "info", textKey: "mbStatusLeave" },
		notdue: { pill: "neu", textKey: "mbStatusNotDue" },
		off: { pill: "neu", textKey: "mbStatusOff" }
	};

	/**
	 * My Timesheet on a phone, after the mobile prototype: one day at a time, a
	 * stepper per project instead of the week grid. Everything behind it - loading the
	 * week, the 8-hour day, leave and bank holidays, closed months, saving and
	 * auto-saving - is the desktop page's own (Timesheet.controller); this only lays
	 * the same rows out differently, in the "mts" model.
	 */
	return Timesheet.extend("bsx.hrx.hrx2026.controller.MobileTimesheet", {

		onInit: function () {
			this.setModel(new JSONModel(this._emptyPhone()), "mts");
			this.setModel(new JSONModel({ open: false, kind: "", title: "", text: "" }), "sheet");
			Timesheet.prototype.onInit.apply(this, arguments);
		},

		/**
		 * Opens on today, or on the day Home's ring was tapped for.
		 */
		_onRouteMatched: function () {
			var oComponent = this.getOwnerComponent();
			var iAsked = oComponent._iPhoneTimesheetDay;

			oComponent._iPhoneTimesheetDay = null;
			this._iDay = typeof iAsked === "number" ? iAsked : (new Date().getDay() + 6) % 7;
			this._bShowErrors = false;
			this.onCloseSheet();

			return Timesheet.prototype._onRouteMatched.apply(this, arguments);
		},

		// The desktop grid's table, groups and selection do not exist here.
		_applyRowsGrouping: function () {},
		_applyCollapsedGroups: function () {},
		onTableUpdated: function () {},
		_clearTableSelection: function () {
			this.getModel("tsView").setProperty("/selectedCount", 0);
		},

		/**
		 * Every change to the rows ends here (loading a week, a stepper, adding or
		 * removing a project), so the phone's own model is rebuilt with it.
		 */
		_recalculate: function () {
			Timesheet.prototype._recalculate.apply(this, arguments);
			this._renderPhone();
		},

		/* =========================================================== */
		/* the phone's model                                           */
		/* =========================================================== */

		_emptyPhone: function () {
			return {
				chips: [],
				day: { title: "", hint: "", pill: "neu", status: "", mode: "entries", banner: "" },
				entries: [],
				week: { label: "", booked: "00:00", target: "00:00", percent: 0, full: false },
				dirty: false,
				status: { text: "", pill: "ok" }
			};
		},

		/**
		 * Builds the day chips, the chosen day's card and the week summary from the
		 * timesheet rows.
		 */
		_renderPhone: function () {
			var oViewModel = this.getModel("tsView");
			var aRows = this.getModel("ts").getProperty("/rows") || [];
			var aDates = this._weekDates(formatter.toDate(oViewModel.getProperty("/weekStart")) || this._mondayOf(new Date()));
			var sToday = this._isoDate(new Date());
			var iDay = Math.min(Math.max(this._iDay || 0, 0), 6);

			var aChips = aDates.map(function (oDate, iIndex) {
				return {
					index: iIndex,
					dw: oDate.toLocaleDateString("en-GB", { weekday: "short" }),
					dn: String(oDate.getDate()),
					label: oDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
					status: this._dayStatus(aRows, aDates, iIndex),
					selected: iIndex === iDay,
					today: this._isoDate(oDate) === sToday,
					off: !this._isWorkingDay(this._scheduleKey(oDate))
				};
			}, this);

			var oDate = aDates[iDay];
			var sStatus = aChips[iDay].status;
			var iTarget = this._dayTarget(oDate);
			var iBooked = this._bookedOn(aRows, iDay);

			var sMode = "entries";
			var sBanner = "";
			if (sStatus === "off") {
				sMode = "banner";
				sBanner = this.getText(this._isWeekend(oDate) ? "mbWeekendBanner" : "mbNonWorkingBanner");
			} else if (sStatus === "leave") {
				sMode = "banner";
				sBanner = this.getText(this._isBankHoliday(aRows, iDay) ? "mbBankHolidayBanner" : "mbLeaveBanner");
			}

			var aEntries = [];
			aRows.forEach(function (oRow, iRow) {
				if (oRow.readOnly) {
					return;
				}
				var oCell = oRow.days[iDay];
				var iMinutes = this._toMinutes(oCell.time);
				aEntries.push({
					path: "/rows/" + iRow + "/days/" + iDay,
					row: iRow,
					name: oRow.project,
					client: oRow.ClientDesc,
					time: this._fromMinutes(iMinutes),
					minutes: iMinutes,
					has: iMinutes > 0,
					comment: oCell.comment || "",
					commentRequired: this._needsComment(oRow),
					// Only after Save has found time booked here without a description.
					error: !!oCell.commentError,
					editable: !!oCell.editable,
					deletable: oRow.deletable !== false,
					quick: QUICK_MINUTES.map(function (iQuick) {
						return {
							minutes: iQuick,
							text: this.getText("mbQuickHours", [iQuick / 60]),
							on: iMinutes === iQuick,
							editable: !!oCell.editable
						};
					}, this)
				});
			}, this);

			var iWeekBooked = this._toMinutes(oViewModel.getProperty("/weekBooked"));
			var iWeekTarget = this._toMinutes(oViewModel.getProperty("/weekTarget"));

			this.getModel("mts").setData({
				chips: aChips,
				day: {
					title: oDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
					hint: this.getText("mbOfDay", [this._fromMinutes(iBooked), this._fromMinutes(iTarget)]),
					pill: STATUS[sStatus].pill,
					status: this.getText(STATUS[sStatus].textKey === "mbStatusOff" && !this._isWeekend(oDate) ?
						"mbStatusNonWorking" : STATUS[sStatus].textKey),
					mode: sMode,
					banner: sBanner
				},
				entries: aEntries,
				week: {
					label: oViewModel.getProperty("/weekLabel"),
					hoursText: this.getText("mbWeekHours", [this._fromMinutes(iWeekBooked), this._fromMinutes(iWeekTarget)]),
					booked: this._fromMinutes(iWeekBooked),
					target: this._fromMinutes(iWeekTarget),
					percent: iWeekTarget ? Math.round(iWeekBooked * 100 / iWeekTarget) : 0,
					full: iWeekTarget > 0 && iWeekBooked >= iWeekTarget
				},
				dirty: this._isDirty(aRows),
				status: this._saveStatus(aRows)
			});
		},

		/**
		 * The save bar's pill: how the last auto-save went, or otherwise whether
		 * anything is still to be saved.
		 * @param {object[]} aRows the timesheet rows
		 * @returns {{text: string, pill: string}} the pill
		 */
		_saveStatus: function (aRows) {
			var oViewModel = this.getModel("tsView");
			var sState = oViewModel.getProperty("/autoSaveState");

			if (AUTO_SAVE_PILL[sState]) {
				return { text: oViewModel.getProperty("/autoSaveText"), pill: AUTO_SAVE_PILL[sState] };
			}
			return this._isDirty(aRows) ?
				{ text: this.getText("mbUnsaved"), pill: "warn" } :
				{ text: this.getText("mbAllSaved"), pill: "ok" };
		},

		/**
		 * The auto-save's progress shows in the save bar as well.
		 */
		_setAutoSaveStatus: function () {
			Timesheet.prototype._setAutoSaveStatus.apply(this, arguments);

			var oModel = this.getModel("mts");
			var aRows = this.getModel("ts").getProperty("/rows") || [];
			if (oModel) {
				oModel.setProperty("/dirty", this._isDirty(aRows));
				oModel.setProperty("/status", this._saveStatus(aRows));
			}
		},

		/**
		 * @param {object[]} aRows the timesheet rows
		 * @param {Date[]} aDates the seven days of the week
		 * @param {number} iIndex the day
		 * @returns {string} complete, partial, missing, leave, notdue or off
		 */
		_dayStatus: function (aRows, aDates, iIndex) {
			var oDate = aDates[iIndex];
			if (!this._isWorkingDay(this._scheduleKey(oDate))) {
				return "off";
			}

			var iTarget = this._dayTarget(oDate);
			if (iTarget === 0) {
				return "leave";
			}

			var iBooked = this._bookedOn(aRows, iIndex);
			if (iBooked >= iTarget) {
				return "complete";
			}
			if (iBooked > 0) {
				return "partial";
			}
			return this._isoDate(oDate) <= this._isoDate(new Date()) ? "missing" : "notdue";
		},

		/**
		 * @param {Date} oDate a working day
		 * @returns {number} the minutes still owed on it: the working day less any leave
		 * or bank holiday on it (a half day of leave leaves four hours)
		 */
		_dayTarget: function (oDate) {
			var iLeave = (this._oNonWorkingDates || {})[this._isoDate(oDate)] || 0;
			// No weekly target from the service: an 8-hour day, as everywhere else.
			var iDay = this._iDayMinutes || 8 * 60;
			return Math.max(iDay - iLeave, 0);
		},

		_bookedOn: function (aRows, iIndex) {
			return aRows.reduce(function (iTotal, oRow) {
				return oRow.readOnly ? iTotal : iTotal + this._toMinutes(oRow.days[iIndex].time);
			}.bind(this), 0);
		},

		_isBankHoliday: function (aRows, iIndex) {
			return aRows.some(function (oRow) {
				return oRow.ProjectID === "NONWORK_bankHolidays" && !!oRow.days[iIndex].time;
			});
		},

		_isWeekend: function (oDate) {
			return oDate.getDay() === 0 || oDate.getDay() === 6;
		},

		/**
		 * @param {Date} oDate a day
		 * @returns {string} its key in the work schedule ("Monday" ... "Sunday")
		 */
		_scheduleKey: function (oDate) {
			return oDate.toLocaleDateString("en-GB", { weekday: "long" });
		},

		/**
		 * @param {object[]} aRows the timesheet rows
		 * @returns {boolean} true when a time or a description differs from what is saved
		 */
		_isDirty: function (aRows) {
			return aRows.some(function (oRow) {
				return !oRow.readOnly && oRow.days.some(function (oDay) {
					return (oDay.time || "") !== (oDay.serviceTime || "") ||
						(oDay.comment || "") !== (oDay.serviceComment || "");
				});
			});
		},

		/* =========================================================== */
		/* days and time                                               */
		/* =========================================================== */

		onDayPress: function (oEvent) {
			this._iDay = oEvent.getSource().getBindingContext("mts").getProperty("index");
			this._renderPhone();
		},

		onStepDown: function (oEvent) {
			this._stepEntry(oEvent, -STEP_MINUTES);
		},

		onStepUp: function (oEvent) {
			this._stepEntry(oEvent, STEP_MINUTES);
		},

		_stepEntry: function (oEvent, iBy) {
			var oEntry = oEvent.getSource().getBindingContext("mts").getObject();
			this._setEntryMinutes(oEntry, Math.min(Math.max(oEntry.minutes + iBy, 0), MAX_MINUTES));
		},

		/**
		 * A quick pick (1h, 2h, 4h, 8h) or Clear.
		 * @param {sap.ui.base.Event} oEvent the button's press event
		 */
		onQuickPick: function (oEvent) {
			var oContext = oEvent.getSource().getBindingContext("mts");
			var sPath = oContext.getPath();
			// A quick pick's own context is .../entries/n/quick/m; Clear's is the entry.
			var oEntry = this.getModel("mts").getProperty(sPath.replace(/\/quick\/\d+$/, ""));
			var iMinutes = /\/quick\/\d+$/.test(sPath) ? oContext.getProperty("minutes") : 0;
			this._setEntryMinutes(oEntry, iMinutes);
		},

		_setEntryMinutes: function (oEntry, iMinutes) {
			var oModel = this.getModel("ts");
			oModel.setProperty(oEntry.path + "/time", iMinutes ? this._fromMinutes(iMinutes) : "");
			// Clearing the time takes away the need for a description too.
			if (!iMinutes) {
				oModel.setProperty(oEntry.path + "/commentError", false);
			}
			this._recalculate();
			this._scheduleAutoSave();
		},

		/**
		 * Typing a description: written straight onto the row, without rebuilding the
		 * day (that would take the cursor out of the box).
		 * @param {sap.ui.base.Event} oEvent the text area's liveChange event
		 */
		onCommentInput: function (oEvent) {
			var oContext = oEvent.getSource().getBindingContext("mts");
			var oEntry = oContext.getObject();
			var sComment = oEvent.getParameter("value") || "";

			this.getModel("ts").setProperty(oEntry.path + "/comment", sComment);
			if (sComment.trim()) {
				this.getModel("ts").setProperty(oEntry.path + "/commentError", false);
				this.getModel("mts").setProperty(oContext.getPath() + "/error", false);
			}
			var aRows = this.getModel("ts").getProperty("/rows") || [];
			this.getModel("mts").setProperty("/dirty", this._isDirty(aRows));
			this.getModel("mts").setProperty("/status", this._saveStatus(aRows));
			this._scheduleAutoSave();
		},

		/* =========================================================== */
		/* add and remove projects                                     */
		/* =========================================================== */

		onPhoneAddProject: function () {
			this._loadAvailable().then(function (bLoaded) {
				if (bLoaded) {
					this._openSheet("add", this.getText("mbAddProject"));
				}
			}.bind(this));
		},

		onPickProject: function (oEvent) {
			var oAssignment = oEvent.getSource().getBindingContext("ts").getObject();
			this.onCloseSheet();
			this._addAssignments([oAssignment]);
			MessageToast.show(this.getText("mbProjectAdded"));
		},

		onPhoneRemove: function (oEvent) {
			var oEntry = oEvent.getSource().getBindingContext("mts").getObject();
			var oRow = this.getModel("ts").getProperty("/rows/" + oEntry.row);
			var iBooked = oRow.days.reduce(function (iTotal, oDay) {
				return iTotal + this._toMinutes(oDay.time);
			}.bind(this), 0);

			this._oRemoveRow = oRow;
			this._openSheet("remove", this.getText("mbRemoveProject"),
				iBooked ? this.getText("mbRemoveProjectBooked", [oRow.project, this._fromMinutes(iBooked)]) :
					this.getText("mbRemoveProjectText", [oRow.project]));
		},

		onConfirmRemove: function () {
			var oRow = this._oRemoveRow;
			var bStored = oRow && oRow.days.some(function (oDay) {
				return !!oDay.recId;
			});

			this.onCloseSheet();
			if (!oRow) {
				return;
			}
			this._oRemoveRow = null;
			// As the desktop's Delete: anything waiting is saved first. A stored row
			// reports through the service's own toast.
			this._flushAutoSave().then(function () {
				return this._deleteRows(this.getModel("ts").getProperty("/rows") || [], [oRow]);
			}.bind(this)).then(function () {
				if (!bStored) {
					MessageToast.show(this.getText("mbProjectRemoved"));
				}
			}.bind(this));
		},

		/* =========================================================== */
		/* save                                                        */
		/* =========================================================== */

		/**
		 * As the desktop's Save (which also waits for an auto-save in progress), but a
		 * missing description takes the user to the day
		 * it is missing on and marks the box, as the prototype does, instead of an error
		 * dialog.
		 */
		onPhoneSave: function () {
			var aRows = this.getModel("ts").getProperty("/rows") || [];
			var iFirstMissing = -1;

			aRows.forEach(function (oRow) {
				if (oRow.readOnly) {
					return;
				}
				oRow.days.forEach(function (oDay, iIndex) {
					oDay.comment = (oDay.comment || "").trim();
					oDay.commentError = !!oDay.time && oDay.time !== "00:00" && this._needsComment(oRow) && !oDay.comment;
					if (oDay.commentError && (iFirstMissing === -1 || iIndex < iFirstMissing)) {
						iFirstMissing = iIndex;
					}
				}, this);
			}, this);

			if (iFirstMissing !== -1) {
				this._iDay = iFirstMissing;
				this.getModel("ts").refresh(true);
				this._renderPhone();
				Toast.error(this.getText("mbCommentMissing"));
				this._scrollToFirstError();
				return;
			}

			this.onSave();
		},

		_scrollToFirstError: function () {
			setTimeout(function () {
				// Only the screen's own list scrolls: scrollIntoView would move the
				// launchpad page as well, and take the app bar off the top.
				var oDomRef = this.getView().getDomRef();
				var oScroller = oDomRef && oDomRef.querySelector(".hrxMbContent");
				var oError = oDomRef && oDomRef.querySelector(".hrxMbEntry[data-error='true']");
				if (oScroller && oError) {
					oScroller.scrollTo({
						top: oError.getBoundingClientRect().top - oScroller.getBoundingClientRect().top + oScroller.scrollTop - 80,
						behavior: "smooth"
					});
				}
			}.bind(this), 0);
		},

		/* =========================================================== */
		/* bottom sheet                                                */
		/* =========================================================== */

		_openSheet: function (sKind, sTitle, sText) {
			this.getModel("sheet").setData({ open: true, kind: sKind, title: sTitle, text: sText || "" });
		},

		onCloseSheet: function () {
			this.getModel("sheet").setProperty("/open", false);
		}
	});
});
