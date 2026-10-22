sap.ui.define([
	"./MobileTimesheet.controller",
	"./Timesheet.controller",
	"sap/ui/model/json/JSONModel",
	"../model/Backend",
	"../model/CurrentUser"
], function (MobileTimesheet, Timesheet, JSONModel, Backend, CurrentUser) {
	"use strict";

	// A day's ring, in the colours of the timesheet's day chips (mobile.css).
	var RING_COLOUR = {
		complete: "#1FAE72",
		partial: "#D97706",
		missing: "#E5484D",
		leave: "#85B7EB",
		notdue: "#E3E6EA",
		off: "#E3E6EA"
	};

	// The Today card's pill: the prototype words an empty working day "Time needed".
	var TODAY_PILL = {
		complete: { pill: "ok", textKey: "mbStatusComplete" },
		partial: { pill: "warn", textKey: "mbStatusPartial" },
		missing: { pill: "crit", textKey: "mbStatusTimeNeeded" },
		notdue: { pill: "crit", textKey: "mbStatusTimeNeeded" },
		leave: { pill: "info", textKey: "mbStatusLeave" },
		off: { pill: "neu", textKey: "mbStatusOff" }
	};

	/**
	 * Home on a phone, after the mobile prototype: today's time, the week as rings,
	 * and the leave balance. Today and the week are worked out exactly as the phone's
	 * timesheet works them out (MobileTimesheet, on the desktop's Timesheet loading);
	 * the balance and the next leave come from the leave service, as My Leave reads it.
	 * Managers get the same Home: their dashboard is for the desktop.
	 */
	return MobileTimesheet.extend("bsx.hrx.hrx2026.controller.MobileHome", {

		onInit: function () {
			this.setModel(new JSONModel({
				today: { date: "", booked: "00:00", of: "", percent: 0, full: false, pill: "neu", status: "" },
				week: "",
				rings: [],
				leave: { loaded: false, remaining: "", allowance: "", next: null }
			}), "mh");

			MobileTimesheet.prototype.onInit.apply(this, arguments);

			// The timesheet's loading, on the home route rather than the timesheet's.
			var oRouter = this.getOwnerComponent().getRouter();
			oRouter.getRoute("timesheet").detachPatternMatched(this._onRouteMatched, this);
			oRouter.getRoute("home").attachPatternMatched(this._onRouteMatched, this);
		},

		/**
		 * This week, from today, and the leave balance.
		 */
		_onRouteMatched: function () {
			this._iDay = (new Date().getDay() + 6) % 7;
			this._loadLeave();
			return Timesheet.prototype._onRouteMatched.apply(this, arguments);
		},

		_renderPhone: function () {
			MobileTimesheet.prototype._renderPhone.apply(this, arguments);
			this._renderHome();
		},

		/**
		 * Today's card and the week's rings, from the day chips the timesheet built.
		 */
		_renderHome: function () {
			var oPhone = this.getModel("mts").getData();
			var aRows = this.getModel("ts").getProperty("/rows") || [];
			var aDates = this._weekDates(this._mondayOf(new Date()));
			var iToday = (new Date().getDay() + 6) % 7;
			var oToday = oPhone.chips[iToday] || {};
			var iBooked = this._bookedOn(aRows, iToday);
			var iTarget = this._dayTarget(aDates[iToday]);
			var oPill = TODAY_PILL[oToday.status] || TODAY_PILL.missing;

			this.getModel("mh").setProperty("/today", {
				date: aDates[iToday].toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
				booked: this._fromMinutes(iBooked),
				of: this.getText("mbRecorded", [this._fromMinutes(iTarget)]),
				percent: iTarget ? Math.min(Math.round(iBooked * 100 / iTarget), 100) : 0,
				full: iTarget > 0 && iBooked >= iTarget,
				pill: oPill.pill,
				status: this.getText(oToday.status === "off" && !this._isWeekend(aDates[iToday]) ? "mbStatusNonWorking" : oPill.textKey)
			});
			this.getModel("mh").setProperty("/week", oPhone.week.label);

			// The working week, Monday to Friday, as the prototype shows it.
			this.getModel("mh").setProperty("/rings", oPhone.chips.slice(0, 5).map(function (oChip) {
				var iMinutes = this._bookedOn(aRows, oChip.index);
				return {
					index: oChip.index,
					day: oChip.dw,
					label: oChip.label,
					html: this._ringHtml(oChip.status, iMinutes, this._dayTarget(aDates[oChip.index]))
				};
			}, this));
		},

		/**
		 * The prototype's ring: a track, the arc of the day booked so far, and the hours
		 * in the middle; a day of leave is a filled disc with a tick.
		 * @param {string} sStatus the day's state
		 * @param {number} iMinutes the minutes booked on it
		 * @param {number} iTarget the minutes owed on it
		 * @returns {string} the ring's markup
		 */
		_ringHtml: function (sStatus, iMinutes, iTarget) {
			var sColour = RING_COLOUR[sStatus] || RING_COLOUR.notdue;
			var fCircumference = 2 * Math.PI * 19;

			if (sStatus === "leave") {
				return "<div class=\"hrxMbRing hrxMbRingLeave\"><svg viewBox=\"0 0 48 48\" aria-hidden=\"true\">" +
					"<circle cx=\"24\" cy=\"24\" r=\"22\" fill=\"" + sColour + "\"/>" +
					"<path d=\"M33 17 21 29l-6-6\" fill=\"none\" stroke=\"#FFFFFF\" stroke-width=\"2.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>" +
					"</svg></div>";
			}

			var fShare = sStatus === "complete" ? 1 : (iTarget ? Math.min(iMinutes / iTarget, 1) : 0);
			var sArc = fShare > 0 ? "<circle cx=\"24\" cy=\"24\" r=\"19\" fill=\"none\" stroke=\"" + sColour +
				"\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-dasharray=\"" + (fShare * fCircumference) + " " + fCircumference +
				"\" transform=\"rotate(-90 24 24)\"/>" : "";
			var sDot = sStatus === "missing" ? "<circle cx=\"24\" cy=\"5\" r=\"2.6\" fill=\"" + sColour + "\"/>" : "";
			var sLabel = sStatus === "notdue" || sStatus === "off" ? "–" : (Math.round(iMinutes / 6) / 10) + "h";

			return "<div class=\"hrxMbRing\"><svg viewBox=\"0 0 48 48\" aria-hidden=\"true\">" +
				"<circle cx=\"24\" cy=\"24\" r=\"19\" fill=\"none\" stroke=\"" + (sStatus === "missing" ? "#FCE9E9" : "#EEF1F4") + "\" stroke-width=\"5\"/>" +
				sArc + sDot + "</svg><span>" + sLabel + "</span></div>";
		},

		/* =========================================================== */
		/* leave                                                       */
		/* =========================================================== */

		/**
		 * The balance and the next leave booked, from the same read My Leave makes.
		 * @returns {Promise} resolved once the leave card is filled (never rejects)
		 */
		_loadLeave: function () {
			var oModel = this.getModel("mh");

			return CurrentUser.ready(this.getOwnerComponent()).then(function (oProfile) {
				if (!oProfile.email) {
					return undefined;
				}
				return Backend.request(Backend.LEAVE + "?cmd=fetchUser&" + new URLSearchParams({
					Email: oProfile.email,
					OrgID: oProfile.orgId
				}).toString(), { method: "GET" }).then(function (oData) {
					var oUser = oData.user || {};
					oModel.setProperty("/leave", {
						loaded: true,
						remaining: oUser.balanceLeaves || "0",
						allowance: this.getText("mbAllowance", [oUser.annualLeaveQuota || "0"]),
						next: this._nextLeave(oData.availedLeaves || [])
					});
				}.bind(this));
			}.bind(this)).catch(function () {
				// The rest of Home still works; the card just shows nothing booked.
				oModel.setProperty("/leave/loaded", true);
			});
		},

		/**
		 * @param {object[]} aDays the availedLeaves list, one record per day
		 * @returns {object|null} the next request still to come (not rejected): its
		 * dates, its type and where it stands
		 */
		_nextLeave: function (aDays) {
			var sToday = this._isoDate(new Date());
			var aComing = aDays.filter(function (oDay) {
				return oDay.Status !== "Rejected" && oDay.Status !== "Cancelled" && oDay.Date >= sToday;
			}).sort(function (a, b) {
				return a.Date.localeCompare(b.Date);
			});
			if (!aComing.length) {
				return null;
			}

			var oFirst = aComing[0];
			var sGroup = oFirst.LeaveGrpID || oFirst.LeaveID;
			var aDates = aComing.filter(function (oDay) {
				return (oDay.LeaveGrpID || oDay.LeaveID) === sGroup;
			}).map(function (oDay) {
				return oDay.Date;
			});

			return {
				text: this.getText("mbNextLeave", [this._range(aDates[0], aDates[aDates.length - 1])]),
				detail: [oFirst.LeaveType, oFirst.Status].join(" · "),
				leave: oFirst.LeaveTypeID || "OTHER"
			};
		},

		/**
		 * @param {string} sFrom first day, yyyy-MM-dd
		 * @param {string} sTo last day, yyyy-MM-dd
		 * @returns {string} "26 Oct 2026", "26 – 27 Oct 2026", "30 Oct – 2 Nov 2026"
		 */
		_range: function (sFrom, sTo) {
			var fnParse = function (sDate) {
				var aParts = sDate.split("-");
				return new Date(Number(aParts[0]), Number(aParts[1]) - 1, Number(aParts[2]));
			};
			var oFrom = fnParse(sFrom);
			var oTo = fnParse(sTo);
			var fnDayMonth = function (oDate) {
				return oDate.getDate() + " " + oDate.toLocaleDateString("en-GB", { month: "short" });
			};

			if (sFrom === sTo) {
				return fnDayMonth(oFrom) + " " + oFrom.getFullYear();
			}
			if (oFrom.getFullYear() !== oTo.getFullYear()) {
				return fnDayMonth(oFrom) + " " + oFrom.getFullYear() + " – " + fnDayMonth(oTo) + " " + oTo.getFullYear();
			}
			if (oFrom.getMonth() !== oTo.getMonth()) {
				return fnDayMonth(oFrom) + " – " + fnDayMonth(oTo) + " " + oTo.getFullYear();
			}
			return oFrom.getDate() + " – " + fnDayMonth(oTo) + " " + oTo.getFullYear();
		},

		/* =========================================================== */
		/* actions                                                     */
		/* =========================================================== */

		onRecordToday: function () {
			this._openTimesheetOn((new Date().getDay() + 6) % 7);
		},

		onRingPress: function (oEvent) {
			this._openTimesheetOn(oEvent.getSource().getBindingContext("mh").getProperty("index"));
		},

		_openTimesheetOn: function (iDay) {
			this.getOwnerComponent()._iPhoneTimesheetDay = iDay;
			this.getOwnerComponent().getRouter().navTo("timesheet");
		},

		onRequestLeave: function () {
			this.getOwnerComponent()._bPhoneOpenLeaveForm = true;
			this.getOwnerComponent().getRouter().navTo("leave");
		}
	});
});
