sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/m/Text",
	"sap/m/HBox",
	"sap/m/Button",
	"sap/ui/core/CustomData",
	"../model/CurrentUser",
	"../model/SicknessPolicy",
	"../model/TimesheetReport",
	"../model/TimesheetReportService",
	"../model/formatter",
	"../model/Mail",
	"../model/Reminders"
], function (Controller, JSONModel, MessageBox, MessageToast, Text, HBox, Button, CustomData, CurrentUser, SicknessPolicy, TimesheetReport, TimesheetReportService, formatter, Mail, Reminders) {
	"use strict";

	var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	var LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
		"October", "November", "December"];

	// The prototype's chart palette, in the order slices take it.
	var COLORS = ["#26AAE2", "#756EE5", "#C43FF6", "#2DD4BF", "#E5B159", "#E5484D"];

	// Our own company, which always takes the first (brand blue) colour.
	var OWN_COMPANY = /bluestonex/i;

	// A Select shows nothing for an item keyed "", so "All" has a key of its own.
	var ALL = "__all";

	// The Timesheet reporting tabs. Utilisation ("util") is a page of its own.
	var REPORT_TABS = ["assign", "days", "break", "sub"];

	// The design's colour bands, as the page's CSS names them.
	var STATE_KEYS = { Success: "ok", Warning: "warn", Error: "crit" };

	var iso = SicknessPolicy.isoDate;
	var parseDay = SicknessPolicy.parseDay;

	return Controller.extend("bsx.hrx.hrx2026.controller.TimesheetReport", {

		formatter: formatter,

		/* =========================================================== */
		/* lifecycle                                                   */
		/* =========================================================== */

		onInit: function () {
			this.setModel(new JSONModel({
				tab: "assign",
				utilMode: false,
				loading: false,
				weekLoading: false,
				progressText: "",
				failedText: "",
				filters: { ClientKey: ALL, ProjectKey: ALL, EmpID: ALL },
				period: {},
				month: {},
				drill: "",
				assign: { q: "", work: "all" },
				sub: { q: "" },
				util: { show: "all" }
			}), "trView");

			this.setModel(new JSONModel({
				customers: [], projects: [], people: [],
				assign: { rows: [], kpis: {}, hint: "", expandText: "" },
				days: { slices: [], top: [], pieHtml: "" },
				brk: { customers: 0, hint: "", expandText: "" },
				sub: { rows: [] },
				util: { rows: [] }
			}), "tr");

			// Open assignments and customers survive a reload or a filter change.
			this._mOpenAssign = {};
			this._mOpenCustomer = {};
			this._oCache = null;
			this._aWeek = null;
			this._iLoad = 0;

			// A click anywhere on an assignment's row opens it, as on the prototype -
			// the chevron button is the keyboard route to the same thing.
			this.byId("trAssignList").addEventDelegate({
				onclick: function (oEvent) {
					var oTarget = oEvent.target;
					if (oTarget.closest(".sapMBtn") || oTarget.closest(".hrxTsAsgSub")) {
						return;
					}
					var oRow = oTarget.closest(".hrxTsAsg");
					if (oRow) {
						this._toggleAssign(oRow.getAttribute("data-key"));
					}
				}
			}, this);

			// A click on a donut segment drills into it, as a click on its name does.
			// Listened for on the card rather than the chart: the chart's markup is swapped
			// out whenever its data changes, and a listener on it went with it.
			this.byId("trPieCard").addEventDelegate({
				onclick: function (oEvent) {
					var oWedge = oEvent.target.closest && oEvent.target.closest(".hrxTsDonut [data-i]");
					if (oWedge) {
						this._drill(parseInt(oWedge.getAttribute("data-i"), 10));
					}
				}
			}, this);

			this.getOwnerComponent().getRouter().getRoute("timesheetreport")
				.attachPatternMatched(this._onRouteMatched, this);
		},

		_onRouteMatched: function (oEvent) {
			// The side rail opens this view as Timesheet reporting (?tab=assign) or as
			// Utilisation (?tab=util); the home dashboard links straight to a tab (?tab=sub).
			var oQuery = oEvent.getParameter("arguments")["?query"] || {};
			var oViewModel = this.getModel("trView");
			var bUtil = oQuery.tab === "util";

			oViewModel.setProperty("/utilMode", bUtil);
			if (bUtil) {
				oViewModel.setProperty("/tab", "util");
			} else if (REPORT_TABS.indexOf(oQuery.tab) !== -1) {
				oViewModel.setProperty("/tab", oQuery.tab);
			} else if (oViewModel.getProperty("/tab") === "util") {
				oViewModel.setProperty("/tab", "assign");
			}

			CurrentUser.ready(this.getOwnerComponent()).then(function (oProfile) {
				this._oProfile = oProfile;
				this._sOrgId = oProfile.orgId;

				if (!oProfile.isManager) {
					return;
				}
				if (!this.getModel("trView").getProperty("/period/from")) {
					this._setYear(0);
				}
				this._setMonth();
				this._load(false);
			}.bind(this));
		},

		/* =========================================================== */
		/* periods                                                     */
		/* =========================================================== */

		/**
		 * @param {number} iBack 0 for this financial year (to today), 1 for the last
		 */
		_setYear: function (iBack) {
			var oToday = new Date();
			var oYear = SicknessPolicy.fiscalYear(SicknessPolicy.fiscalYearOf(oToday).startYear - iBack);
			var oTo = iBack ? oYear.end : oToday;

			this._setPeriod(oYear.start, oTo, this.getText(iBack ? "trLastYearTitle" : "trThisYearTitle"));
		},

		_setPeriod: function (oFrom, oTo, sTitle) {
			var oDates = this.byId("trPeriod");
			oDates.setDateValue(oFrom);
			oDates.setSecondDateValue(oTo);

			this.getModel("trView").setProperty("/period", {
				from: iso(oFrom),
				to: iso(oTo),
				label: this._rangeText(iso(oFrom), iso(oTo)),
				title: sTitle
			});
		},

		_setMonth: function () {
			var oToday = new Date();
			var oStart = new Date(oToday.getFullYear(), oToday.getMonth(), 1);
			var oEnd = new Date(oToday.getFullYear(), oToday.getMonth() + 1, 0);

			this.getModel("trView").setProperty("/month", {
				from: iso(oStart),
				to: iso(oEnd),
				label: LONG_MONTHS[oToday.getMonth()] + " " + oToday.getFullYear()
			});
		},

		/* =========================================================== */
		/* data loading                                                */
		/* =========================================================== */

		/**
		 * Reads everybody's timesheets for the period and the current month, unless
		 * they are already held. Timesheets are read one person at a time (see
		 * TimesheetReportService), so a period inside what is already loaded is
		 * answered from memory.
		 * @param {boolean} bForce true to read again even when the period is held
		 * @returns {Promise} resolved once the page is drawn
		 */
		_load: function (bForce) {
			var oViewModel = this.getModel("trView");
			var oPeriod = oViewModel.getProperty("/period");
			var oMonth = oViewModel.getProperty("/month");
			var sFrom = oPeriod.from < oMonth.from ? oPeriod.from : oMonth.from;
			var sTo = oPeriod.to > oMonth.to ? oPeriod.to : oMonth.to;
			var oCache = this._oCache;

			if (!bForce && oCache && oCache.from <= sFrom && oCache.to >= sTo) {
				this._render();
				return Promise.resolve();
			}

			var iLoad = ++this._iLoad;
			var oModel = this.getOwnerComponent().getModel();

			oViewModel.setProperty("/loading", true);
			oViewModel.setProperty("/progressText", this.getText("trLoadingPeople"));

			if (bForce || !this._pPeople) {
				this._pPeople = TimesheetReportService.loadPeople(oModel, this._sOrgId);
			}

			return this._pPeople.then(function (aPeople) {
				return TimesheetReportService.loadBookings(aPeople, this._sOrgId, sFrom, sTo, function (iDone, iOf) {
					if (iLoad === this._iLoad) {
						oViewModel.setProperty("/progressText", this.getText("trLoadingProgress", [iDone, iOf]));
					}
				}.bind(this));
			}.bind(this)).then(function (oResult) {
				if (iLoad !== this._iLoad) {
					return;
				}
				this._oCache = { from: sFrom, to: sTo, bookings: oResult.bookings };
				oViewModel.setProperty("/failedText", oResult.failed.length ? this.getText("trFailed", [
					oResult.failed.length,
					oResult.failed.map(function (oPerson) {
						return oPerson.Name;
					}).join(", ")
				]) : "");
				this._setStamp(this.getText("trStamp", [this._clock(new Date())]));
				this._render();
			}.bind(this)).catch(function (oError) {
				if (iLoad === this._iLoad) {
					this._pPeople = null;
					this._showError("trErrorLoad", oError);
				}
			}.bind(this)).then(function () {
				if (iLoad === this._iLoad) {
					oViewModel.setProperty("/loading", false);
				}
			}.bind(this));
		},

		/**
		 * This week's hours for Who's submitted - one call for the whole organisation.
		 * @param {boolean} bForce true to read again
		 * @returns {Promise} resolved once the tab is drawn
		 */
		_loadWeek: function (bForce) {
			var oViewModel = this.getModel("trView");

			if (this._aWeek && !bForce) {
				this._renderSubmitted();
				return Promise.resolve();
			}

			var oMonday = this._monday(new Date());
			var oSunday = new Date(oMonday.getFullYear(), oMonday.getMonth(), oMonday.getDate() + 6);
			this._oWeek = { from: iso(oMonday), to: iso(oSunday) };

			oViewModel.setProperty("/weekLoading", true);
			return TimesheetReportService.loadWeek(this._oWeek.from, this._oWeek.to).then(function (aRows) {
				this._aWeek = aRows;
				this._renderSubmitted();
			}.bind(this)).catch(function (oError) {
				this._aWeek = null;
				this._showError("trErrorWeek", oError);
			}.bind(this)).then(function () {
				oViewModel.setProperty("/weekLoading", false);
			});
		},

		/* =========================================================== */
		/* drawing                                                     */
		/* =========================================================== */

		_render: function () {
			if (!this._oCache) {
				return;
			}
			this._renderOptions();

			switch (this.getModel("trView").getProperty("/tab")) {
				case "days":
					this._renderDays();
					break;
				case "break":
					this._renderBreakdown();
					break;
				case "sub":
					this._loadWeek(false);
					break;
				case "util":
					this._renderUtil();
					break;
				default:
					this._renderAssign();
			}
		},

		/**
		 * Fills the customer, project and resource pickers from what was booked, and
		 * drops a project that is no longer under the chosen customer.
		 */
		_renderOptions: function () {
			var oViewModel = this.getModel("trView");
			var oFilters = this._filterValues();
			var aBookings = this._oCache.bookings;
			var sAll = this.getText("trAll");

			var fnOptions = function (aList, sKey, sLabel) {
				var mSeen = {};
				var aOptions = [];
				aList.forEach(function (oBooking) {
					if (!mSeen[oBooking[sKey]]) {
						mSeen[oBooking[sKey]] = true;
						aOptions.push({ key: oBooking[sKey], label: oBooking[sLabel] });
					}
				});
				return [{ key: ALL, label: sAll }].concat(aOptions.sort(function (a, b) {
					return a.label.localeCompare(b.label);
				}));
			};

			var aProjects = fnOptions(aBookings.filter(function (oBooking) {
				return !oFilters.ClientKey || oBooking.ClientKey === oFilters.ClientKey;
			}), "ProjectKey", "ProjectDesc");

			if (oFilters.ProjectKey && !aProjects.some(function (oOption) {
				return oOption.key === oFilters.ProjectKey;
			})) {
				oViewModel.setProperty("/filters/ProjectKey", ALL);
			}

			var oModel = this.getModel("tr");
			oModel.setProperty("/customers", fnOptions(aBookings, "ClientKey", "ClientDesc"));
			oModel.setProperty("/projects", aProjects);
			oModel.setProperty("/people", fnOptions(aBookings, "EmpID", "Name"));
		},

		/**
		 * @returns {object} the chosen ClientKey, ProjectKey and EmpID, "" for all
		 */
		_filterValues: function () {
			var oFilters = this.getModel("trView").getProperty("/filters");
			var fnValue = function (sKey) {
				return !sKey || sKey === ALL ? "" : sKey;
			};
			return {
				ClientKey: fnValue(oFilters.ClientKey),
				ProjectKey: fnValue(oFilters.ProjectKey),
				EmpID: fnValue(oFilters.EmpID)
			};
		},

		_filtered: function () {
			return TimesheetReport.filter(this._oCache.bookings, this._filterValues());
		},

		_renderAssign: function () {
			var oViewModel = this.getModel("trView");
			var oPeriod = oViewModel.getProperty("/period");
			var aAll = TimesheetReport.assignments(this._filtered(), oPeriod, oViewModel.getProperty("/month"));
			var sQuery = (oViewModel.getProperty("/assign/q") || "").toLowerCase();
			var sWork = oViewModel.getProperty("/assign/work");

			var aRows = aAll.filter(function (oRow) {
				var bWork = sWork === "all" || (sWork === "bill" && oRow.Billable) || (sWork === "int" && !oRow.Billable);
				var sText = [oRow.ClientDesc, oRow.ProjectDesc, oRow.Name].concat(oRow.logs.map(function (oLog) {
					return oLog.Comment;
				})).join(" ").toLowerCase();
				return bWork && (!sQuery || sText.indexOf(sQuery) !== -1);
			}).map(function (oRow) {
				var iLogs = oRow.logs.length;
				return Object.assign(oRow, {
					open: !!this._mOpenAssign[oRow.key],
					bookingsText: iLogs ? this.getText(iLogs === 1 ? "trBooking" : "trBookings", [iLogs]) : this.getText("trNoBookingsShort"),
					projectLine: oRow.ProjectDesc + " - " + (oRow.Billable && oRow.PONo ? this._poText(oRow.PONo) : this.getText("trNoPo")),
					rateText: oRow.rate ? this._money(oRow.rate, oRow.Currency) : "—",
					monthText: oRow.month !== null ? this._money(oRow.month, oRow.Currency) : "—",
					totalText: oRow.total !== null ? this._money(oRow.total, oRow.Currency) : "—",
					logs: oRow.logs.map(function (oLog) {
						return Object.assign({}, oLog, {
							dateText: this._dayText(oLog.Date),
							hoursText: this._hours(oLog.Minutes)
						});
					}, this)
				});
			}, this);

			var aBillable = aAll.filter(function (oRow) {
				return oRow.Billable;
			});
			var mClients = {};
			aBillable.forEach(function (oRow) {
				mClients[oRow.ClientKey] = true;
			});
			var iBookings = aRows.reduce(function (iTotal, oRow) {
				return iTotal + oRow.logs.length;
			}, 0);
			var bAllOpen = aRows.length > 0 && aRows.every(function (oRow) {
				return oRow.open;
			});

			this.getModel("tr").setProperty("/assign", {
				rows: aRows,
				hint: this.getText("trAssignHint", [aRows.length, iBookings]),
				expandText: this.getText(bAllOpen ? "trCollapseAll" : "trExpandAll"),
				kpis: {
					billable: aBillable.length,
					billableSub: this.getText("trOfAssignments", [aAll.length]),
					clients: Object.keys(mClients).length,
					billed: this._money(aBillable.reduce(function (fTotal, oRow) {
						return fTotal + (oRow.total || 0);
					}, 0)),
					month: this._money(aBillable.reduce(function (fTotal, oRow) {
						return fTotal + (oRow.month || 0);
					}, 0))
				}
			});
		},

		_renderDays: function () {
			var oViewModel = this.getModel("trView");
			var sDrill = oViewModel.getProperty("/drill");
			var oOverview = TimesheetReport.overview(this._filtered(), oViewModel.getProperty("/period"), sDrill);
			var fSliceTotal = oOverview.slices.reduce(function (fTotal, oSlice) {
				return fTotal + oSlice.value;
			}, 0);
			var fTop = oOverview.top.length ? oOverview.top[0].value : 1;

			// Bluestonex - our own company - is always the brand blue; other customers take
			// the rest of the palette in order. A customer's projects start from the
			// customer's own colour, so the slice clicked keeps its colour as it opens up.
			var bOwnCompany = !sDrill && oOverview.slices.some(function (oSlice) {
				return OWN_COMPANY.test(oSlice.label);
			});
			var iNext = bOwnCompany ? 1 : 0;

			var aSlices = oOverview.slices.map(function (oSlice, iIndex) {
				var iColour;
				if (sDrill) {
					iColour = ((this._iDrillColour || 0) + iIndex) % COLORS.length;
				} else if (OWN_COMPANY.test(oSlice.label)) {
					iColour = 0;
				} else {
					iColour = iNext++ % COLORS.length;
				}
				var sColor = COLORS[iColour];
				return Object.assign(oSlice, {
					colourIndex: iColour,
					colourKey: String(iColour),
					color: sColor,
					valueText: this._num(oSlice.value)
				});
			}, this);

			var sDrillLabel = "";
			if (sDrill) {
				var oCustomer = this._oCache.bookings.filter(function (oBooking) {
					return oBooking.ClientKey === sDrill;
				})[0];
				sDrillLabel = oCustomer ? oCustomer.ClientDesc : "";
			}

			var sTitle = sDrill ? this.getText("trProjectsAt", [sDrillLabel]) : this.getText("trDaysByCustomer");

			this.getModel("tr").setProperty("/days", {
				totalText: this._num(oOverview.total),
				billableText: this._num(oOverview.billable),
				nonBillableText: this._num(oOverview.nonBillable),
				title: sTitle,
				hint: sDrill ?
					this.getText(aSlices.length === 1 ? "trOneProject" : "trProjectsCount", [aSlices.length]) :
					this.getText("trDaysHint"),
				slices: aSlices,
				pieHtml: this._pieHtml(aSlices, fSliceTotal, sTitle),
				top: oOverview.top.map(function (oProject) {
					return {
						label: oProject.label,
						valueText: this._num(oProject.value),
						width: this._width(oProject.value / fTop * 100)
					};
				}, this)
			});
		},

		/**
		 * The design's donut: a pale track with one arc per slice laid over it, from
		 * twelve o'clock clockwise, and the total days in the middle. Each arc carries
		 * its index so a click on it can drill into that customer.
		 * @param {Array<object>} aSlices slices with label, value, valueText and color
		 * @param {number} fTotal the sum of the slices
		 * @param {string} sTitle what the chart shows, for screen readers
		 * @returns {string} the chart's SVG
		 */
		_pieHtml: function (aSlices, fTotal, sTitle) {
			if (!aSlices.length || !fTotal) {
				return "<div></div>";
			}
			var fnEscape = function (sText) {
				return String(sText).replace(/[&<>"]/g, function (sChar) {
					return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[sChar];
				});
			};
			var fCircumference = 2 * Math.PI * 42;
			var fOffset = 0;
			var bDrill = !!this.getModel("trView").getProperty("/drill");

			var sArcs = aSlices.map(function (oSlice, iIndex) {
				var fLength = oSlice.value / fTotal * fCircumference;
				var sArc = "<circle data-i=\"" + iIndex + "\" class=\"hrxTsSeg" + (bDrill ? "" : " hrxTsSegActive") + "\"" +
					" cx=\"50\" cy=\"50\" r=\"42\" fill=\"none\" stroke=\"" + oSlice.color + "\" stroke-width=\"13\"" +
					" stroke-dasharray=\"" + fLength + " " + (fCircumference - fLength) + "\"" +
					" stroke-dashoffset=\"" + (-fOffset) + "\" transform=\"rotate(-90 50 50)\">" +
					"<title>" + fnEscape(oSlice.label + ": " + oSlice.valueText + " days") + "</title></circle>";
				fOffset += fLength;
				return sArc;
			}).join("");

			var sTrack = "<circle cx=\"50\" cy=\"50\" r=\"42\" fill=\"none\" class=\"hrxTsDonutTrack\" stroke-width=\"13\"/>";
			var sCentre = "<text x=\"50\" y=\"49\" text-anchor=\"middle\" class=\"hrxTsDonutTotal\">" + fnEscape(this._num(fTotal)) + "</text>" +
				"<text x=\"50\" y=\"62\" text-anchor=\"middle\" class=\"hrxTsDonutUnit\">" + fnEscape(this.getText("trDaysUnit").toUpperCase()) + "</text>";

			return "<div class=\"hrxTsDonutWrap\"><svg viewBox=\"0 0 100 100\" class=\"hrxTsDonut\" role=\"img\" aria-label=\"" +
				fnEscape(sTitle) + "\">" + sTrack + sArcs + sCentre + "</svg></div>";
		},

		/**
		 * Builds the customer/project by resource table. Its columns depend on who
		 * booked time under the current filters, so its rows are put together here
		 * rather than bound in the view: a customer row (click or chevron to open it),
		 * its projects when open, and the totals row.
		 */
		_renderBreakdown: function () {
			var oBreak = TimesheetReport.breakdown(this._filtered(), this.getModel("trView").getProperty("/period"));
			var oTable = this.byId("trBreakTable");
			var iProjects = 0;

			var fnCell = function (sText, sClass) {
				var oText = new Text({ text: sText, wrapping: false, textAlign: "End" }).addStyleClass("hrxTsNum");
				return sClass ? oText.addStyleClass(sClass) : oText;
			};
			var fnDays = function (fDays) {
				return fDays ? this._num(fDays) : "–";
			}.bind(this);
			var fnRow = function (aCells, sClass) {
				return new HBox({ renderType: "Bare", items: aCells }).addStyleClass("hrxTsTr hrxTsBrkRow " + sClass);
			};

			oTable.destroyItems();

			// The header row: Customer / Project, one column per person, Totals.
			oTable.addItem(fnRow([new Text({ text: this.getText("trColCustomerProject"), wrapping: false })]
				.concat(oBreak.people.map(function (oPerson) {
					return fnCell(oPerson.label);
				}), [fnCell(this.getText("trColTotals"))]), "hrxTsTh"));

			oBreak.customers.forEach(function (oCustomer) {
				var bOpen = !!this._mOpenCustomer[oCustomer.key];
				iProjects += oCustomer.projects.length;

				var oChevron = new Button({
					type: "Transparent",
					tooltip: this.getText("trShowProjects"),
					press: this._toggleCustomer.bind(this, oCustomer.key)
				}).addStyleClass("hrxTsChev");

				var oGroup = fnRow([new HBox({
					renderType: "Bare",
					items: [
						oChevron,
						new Text({ text: oCustomer.label }),
						new Text({
							text: this.getText(oCustomer.projects.length === 1 ? "trProject1" : "trProjectsN", [oCustomer.projects.length]),
							wrapping: false
						}).addStyleClass("hrxTsGrpCount")
					]
				}).addStyleClass("hrxTsGrpName")].concat(oBreak.people.map(function (oPerson) {
					return fnCell(fnDays(oCustomer.byEmp[oPerson.EmpID]));
				}), [fnCell(this._num(oCustomer.total))]), "hrxTsGrp");

				oGroup.addCustomData(new CustomData({ key: "open", value: bOpen ? "yes" : "no", writeToDom: true }));
				// A click anywhere on the customer's row opens it, as on the design.
				oGroup.addEventDelegate({
					onclick: function (oEvent) {
						if (!oEvent.target.closest(".sapMBtn")) {
							this._toggleCustomer(oCustomer.key);
						}
					}
				}, this);
				oTable.addItem(oGroup);

				if (bOpen) {
					oCustomer.projects.forEach(function (oProject) {
						oTable.addItem(fnRow([new Text({ text: oProject.label }).addStyleClass("hrxTsIndent")]
							.concat(oBreak.people.map(function (oPerson) {
								return fnCell(fnDays(oProject.byEmp[oPerson.EmpID]));
							}), [fnCell(this._num(oProject.total))]), "hrxTsBrkProject"));
					}, this);
				}
			}, this);

			if (oBreak.customers.length) {
				oTable.addItem(fnRow([new Text({ text: this.getText("trColTotals") })].concat(oBreak.people.map(function (oPerson) {
					return fnCell(this._num(oBreak.byEmp[oPerson.EmpID] || 0));
				}, this), [fnCell(this._num(oBreak.total))]), "hrxTsBrkTotals"));
			}

			var bAllOpen = oBreak.customers.length > 0 && oBreak.customers.every(function (oCustomer) {
				return this._mOpenCustomer[oCustomer.key];
			}, this);
			this._aBreakCustomers = oBreak.customers.map(function (oCustomer) {
				return oCustomer.key;
			});

			this.getModel("tr").setProperty("/brk", {
				customers: oBreak.customers.length,
				hint: this.getText("trBreakHint", [oBreak.customers.length, iProjects]),
				expandText: this.getText(bAllOpen ? "trCollapseAll" : "trExpandAll")
			});
		},

		_renderSubmitted: function () {
			var oViewModel = this.getModel("trView");
			var sQuery = (oViewModel.getProperty("/sub/q") || "").toLowerCase();

			var aAll = (this._aWeek || []).map(function (oRow) {
				var bNothingDue = oRow.expectedMinutes <= 0;
				var bComplete = bNothingDue || oRow.bookedMinutes >= oRow.expectedMinutes;
				var fPct = bNothingDue ? 100 : Math.min(100, oRow.bookedMinutes / oRow.expectedMinutes * 100);
				var sState = bComplete ? "Success" : fPct >= 60 ? "Warning" : "Error";

				return Object.assign({}, oRow, {
					initials: formatter.nameInitials(oRow.Name),
					nothingDue: bNothingDue,
					complete: bComplete,
					pct: fPct,
					state: STATE_KEYS[sState],
					width: this._width(fPct),
					hoursText: this.getText("trHoursOf", [this._hours(oRow.bookedMinutes), this._hours(oRow.expectedMinutes)]),
					statusText: this.getText(bNothingDue ? "trNothingDue" : bComplete ? "trFullyBooked" :
						oRow.bookedMinutes ? "trUnderTarget" : "trNotStarted"),
					statusState: bComplete ? "ok" : oRow.bookedMinutes ? "warn" : "crit"
				});
			}, this);

			var aDue = aAll.filter(function (oRow) {
				return !oRow.nothingDue;
			});
			var iFull = aDue.filter(function (oRow) {
				return oRow.complete;
			}).length;
			var iCompliance = aDue.length ? Math.round(iFull / aDue.length * 100) : 100;

			var aRows = aAll.filter(function (oRow) {
				return !sQuery || oRow.Name.toLowerCase().indexOf(sQuery) !== -1;
			}).sort(function (a, b) {
				return (a.pct - b.pct) || a.Name.localeCompare(b.Name);
			});

			this.getModel("tr").setProperty("/sub", {
				rows: aRows,
				compliance: iCompliance,
				complianceState: iCompliance >= 90 ? "ok" : "crit",
				under: aDue.length - iFull,
				full: iFull,
				hint: this.getText("trWeekHint", [aAll.length, this._rangeText(this._oWeek.from, this._oWeek.to)])
			});
		},

		_renderUtil: function () {
			var oViewModel = this.getModel("trView");
			var sShow = oViewModel.getProperty("/util/show");

			// Utilisation is a share of everything a person booked, so the customer,
			// project and resource filters of Timesheet reporting do not apply here (the
			// Utilisation page has only Period and Show, as on the design).
			var aPeople = TimesheetReport.utilisation(this._oCache.bookings, oViewModel.getProperty("/period")).filter(function (oPerson) {
				return sShow === "all" || (sShow === "bill" && oPerson.billable > 0) ||
					(sShow === "u50" && oPerson.pct < 50) || (sShow === "u80" && oPerson.pct < 80);
			});

			var fBillable = aPeople.reduce(function (fTotal, oPerson) {
				return fTotal + oPerson.billable;
			}, 0);
			var fTotal = aPeople.reduce(function (fSum, oPerson) {
				return fSum + oPerson.total;
			}, 0);
			var iTeam = fTotal ? Math.round(fBillable / fTotal * 100) : 0;
			var iOnBillable = aPeople.filter(function (oPerson) {
				return oPerson.billable > 0;
			}).length;

			this.getModel("tr").setProperty("/util", {
				team: iTeam,
				teamState: iTeam ? STATE_KEYS[TimesheetReport.utilState(iTeam)] : "neu",
				onBillable: iOnBillable + " / " + aPeople.length,
				billable: this._num(fBillable),
				total: this._num(fTotal),
				hint: this.getText("trUtilHint", [aPeople.length, oViewModel.getProperty("/period/label")]),
				rows: aPeople.map(function (oPerson) {
					var iCount = oPerson.projects.length;
					return Object.assign({}, oPerson, {
						billableText: this._num(oPerson.billable),
						totalText: this._num(oPerson.total),
						pctText: oPerson.pct + "%",
						state: STATE_KEYS[TimesheetReport.utilState(oPerson.pct)],
						width: this._width(oPerson.pct),
						projectsCount: iCount === 0 ? this.getText("trNoBillableProject") :
							this.getText(iCount === 1 ? "trOneBillableProject" : "trBillableProjects", [iCount]),
						projectsText: oPerson.projects.join(", ") || "—"
					});
				}, this)
			});
		},

		/* =========================================================== */
		/* events                                                      */
		/* =========================================================== */

		onRefresh: function () {
			if (!this._oProfile || !this._oProfile.isManager) {
				return;
			}
			this._setMonth();
			this._load(true).then(function () {
				if (this._aWeek) {
					this._loadWeek(true);
				}
				MessageToast.show(this.getText("trRefreshed"));
			}.bind(this));
		},

		/**
		 * One of the Timesheet reporting tabs was pressed: its key is in the button's
		 * "tab" custom data.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onTabPress: function (oEvent) {
			this.getModel("trView").setProperty("/tab", oEvent.getSource().data("tab"));
			this._render();
		},

		onFilterChange: function () {
			this.getModel("trView").setProperty("/drill", "");
			this._render();
		},

		onPeriodChange: function () {
			var oDates = this.byId("trPeriod");
			var oFrom = oDates.getDateValue();
			if (!oFrom) {
				this._setYear(0);
			} else {
				this._setPeriod(oFrom, oDates.getSecondDateValue() || oFrom, this.getText("trSelectedPeriod"));
			}
			this._load(false);
		},

		onThisYear: function () {
			this._setYear(0);
			this._load(false);
		},

		onLastYear: function () {
			this._setYear(1);
			this._load(false);
		},

		onClear: function () {
			var oViewModel = this.getModel("trView");
			oViewModel.setProperty("/filters", { ClientKey: ALL, ProjectKey: ALL, EmpID: ALL });
			oViewModel.setProperty("/drill", "");
			oViewModel.setProperty("/assign", { q: "", work: "all" });
			oViewModel.setProperty("/sub/q", "");
			oViewModel.setProperty("/util/show", "all");
			this._setYear(0);
			this._load(false);
		},

		onAssignSearch: function () {
			this._renderAssign();
		},

		onToggleAssign: function (oEvent) {
			this._toggleAssign(oEvent.getSource().getBindingContext("tr").getProperty("key"));
		},

		_toggleAssign: function (sKey) {
			if (!sKey) {
				return;
			}
			this._mOpenAssign[sKey] = !this._mOpenAssign[sKey];
			this._renderAssign();
		},

		onExpandAllAssign: function () {
			var aRows = this.getModel("tr").getProperty("/assign/rows");
			var bOpen = !aRows.every(function (oRow) {
				return oRow.open;
			});
			aRows.forEach(function (oRow) {
				this._mOpenAssign[oRow.key] = bOpen;
			}, this);
			this._renderAssign();
		},

		onSliceSelect: function (oEvent) {
			var sPath = oEvent.getSource().getBindingContext("tr").getPath();
			this._drill(parseInt(sPath.split("/").pop(), 10));
		},

		_drill: function (iIndex) {
			var oViewModel = this.getModel("trView");
			var oSlice = this.getModel("tr").getProperty("/days/slices/" + iIndex);
			if (oViewModel.getProperty("/drill") || !oSlice) {
				return;
			}
			this._iDrillColour = oSlice.colourIndex || 0;
			oViewModel.setProperty("/drill", oSlice.key);
			this._renderDays();
		},

		onAllCustomers: function () {
			this.getModel("trView").setProperty("/drill", "");
			this._renderDays();
		},

		_toggleCustomer: function (sKey) {
			this._mOpenCustomer[sKey] = !this._mOpenCustomer[sKey];
			this._renderBreakdown();
		},

		onExpandAllBreakdown: function () {
			var aKeys = this._aBreakCustomers || [];
			var bOpen = !aKeys.every(function (sKey) {
				return this._mOpenCustomer[sKey];
			}, this);
			aKeys.forEach(function (sKey) {
				this._mOpenCustomer[sKey] = bOpen;
			}, this);
			this._renderBreakdown();
		},

		onSubSearch: function () {
			this._renderSubmitted();
		},

		onRefreshWeek: function () {
			this._loadWeek(true).then(function () {
				MessageToast.show(this.getText("trWeekRefreshed", [this.getModel("tr").getProperty("/sub/compliance")]));
			}.bind(this));
		},

		/**
		 * Reminds one person to complete their timesheet: sent by the HRX service, or a
		 * draft in the admin's own mail app where it cannot send.
		 * @param {sap.ui.base.Event} oEvent the button press event
		 */
		onRemind: function (oEvent) {
			var oRow = oEvent.getSource().getBindingContext("tr").getObject();
			if (!oRow.Email) {
				MessageBox.error(this.getText("trNoEmail", [oRow.Name]));
				return;
			}
			var sSubject = this._remindSubject();
			var sMessage = this.getText("trRemindBody", [oRow.Name.split(/\s+/)[0], this._weekText(),
				this._hours(oRow.bookedMinutes), this._hours(oRow.expectedMinutes)]);
			this._sendReminder([oRow], sSubject, sMessage, { to: oRow.Email, subject: sSubject, body: sMessage });
		},

		/**
		 * Reminds everybody under target (a draft has them all in BCC, so nobody sees the others).
		 */
		onRemindAll: function () {
			var aUnder = ((this._aWeek && this.getModel("tr").getProperty("/sub/rows")) || []).filter(function (oRow) {
				return !oRow.complete && oRow.Email;
			});
			if (!aUnder.length) {
				MessageToast.show(this.getText("trNoReminders"));
				return;
			}
			var sSubject = this._remindSubject();
			var sMessage = this.getText("trRemindAllBody", [this._weekText()]);
			var sBcc = aUnder.map(function (oRow) {
				return oRow.Email;
			}).join(",");
			this._sendReminder(aUnder, sSubject, sMessage, { bcc: sBcc, subject: sSubject, body: sMessage });
		},

		_sendReminder: function (aRows, sSubject, sMessage, oDraft) {
			Reminders.send({
				kind: "Timesheet",
				employeeIds: aRows.map(function (oRow) {
					return oRow.UserID;
				}),
				subject: sSubject,
				message: sMessage,
				draft: oDraft
			}).then(function (sOutcome) {
				if (sOutcome === "sent") {
					MessageToast.show(this.getText("reminderSentCount", [aRows.length]));
				}
			}.bind(this)).catch(function (oError) {
				MessageBox.error(this.getText("reminderFailed", [oError.message]));
			}.bind(this));
		},

		onUtilShow: function () {
			this._renderUtil();
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

		/**
		 * @param {number} fPct how full a bar is, 0 to 100
		 * @returns {string} the bar's fill width as CSS, e.g. "42.5%"
		 */
		_width: function (fPct) {
			return Math.max(0, Math.min(100, fPct || 0)).toFixed(1) + "%";
		},

		/**
		 * @param {string} sPONo a purchase order number as held on the project
		 * @returns {string} as the design shows it, e.g. "PO 4500127"
		 */
		_poText: function (sPONo) {
			return /^PO\b/i.test(sPONo) ? sPONo : "PO " + sPONo;
		},

		/**
		 * Shows when the data was read next to the header's reload button. Kept per page
		 * by the shell, so it is still there when the user comes back.
		 * @param {string} sStamp e.g. "Last refreshed 09:41"
		 */
		_setStamp: function (sStamp) {
			var oAppModel = this.getOwnerComponent().getModel("app");
			// The whole object: a JSONModel does not create a missing parent on set.
			oAppModel.setProperty("/stamps", Object.assign({}, oAppModel.getProperty("/stamps"), { timesheetreport: sStamp }));
			oAppModel.setProperty("/page/stamp", sStamp);
		},

		_remindSubject: function () {
			return this.getText("trRemindSubject", [this._weekText()]);
		},

		_weekText: function () {
			return this._oWeek ? this._rangeText(this._oWeek.from, this._oWeek.to) : "";
		},

		_monday: function (oDate) {
			var oCopy = new Date(oDate.getFullYear(), oDate.getMonth(), oDate.getDate());
			oCopy.setDate(oCopy.getDate() - ((oCopy.getDay() + 6) % 7));
			return oCopy;
		},

		/**
		 * @param {number} fValue a number of days
		 * @returns {string} to two decimal places, as the prototype shows days
		 */
		_num: function (fValue) {
			return Number(fValue || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		},

		/**
		 * @param {number} fValue an amount
		 * @param {string} [sCurrency] its currency, GBP when not given
		 * @returns {string} e.g. "£1,250"
		 */
		_money: function (fValue, sCurrency) {
			var sSymbol = (!sCurrency || sCurrency === "GBP") ? "£" : sCurrency + " ";
			return sSymbol + Number(fValue || 0).toLocaleString("en-GB", { maximumFractionDigits: 0 });
		},

		/**
		 * @param {number} iMinutes a duration
		 * @returns {string} as hh:mm
		 */
		_hours: function (iMinutes) {
			var iWhole = Math.round(iMinutes || 0);
			return String(Math.floor(iWhole / 60)).padStart(2, "0") + ":" + String(iWhole % 60).padStart(2, "0");
		},

		_clock: function (oDate) {
			return String(oDate.getHours()).padStart(2, "0") + ":" + String(oDate.getMinutes()).padStart(2, "0");
		},

		_dayText: function (sDay) {
			var oDay = parseDay(sDay);
			return oDay.getDate() + " " + MONTHS[oDay.getMonth()] + " " + oDay.getFullYear();
		},

		/**
		 * @param {string} sStart the first day, "yyyy-MM-dd"
		 * @param {string} sEnd the last day, "yyyy-MM-dd"
		 * @returns {string} e.g. "5 – 11 Oct 2026", "1 Apr – 8 Oct 2026"
		 */
		_rangeText: function (sStart, sEnd) {
			var oStart = parseDay(sStart);
			var oEnd = parseDay(sEnd);
			var sEndText = this._dayText(sEnd);

			if (sStart === sEnd) {
				return sEndText;
			}
			if (oStart.getFullYear() !== oEnd.getFullYear()) {
				return this._dayText(sStart) + " – " + sEndText;
			}
			if (oStart.getMonth() !== oEnd.getMonth()) {
				return oStart.getDate() + " " + MONTHS[oStart.getMonth()] + " – " + sEndText;
			}
			return oStart.getDate() + " – " + sEndText;
		},

		_showError: function (sTextKey, oError) {
			MessageBox.error(this.getText(sTextKey), {
				details: (oError && oError.message) || String(oError)
			});
		}
	});
});
