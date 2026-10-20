sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Fragment",
	"sap/ui/Device",
	"../model/Backend",
	"../model/CurrentUser",
	"../model/formatter",
	"sap/ui/core/format/DateFormat",
	"../model/Notifications",
	"../model/NotificationService"
], function (Controller, Fragment, Device, Backend, CurrentUser, formatter, DateFormat, Notifications, NotificationService) {
	"use strict";

	// The bell re-reads its sources at most this often while the user moves around
	// (opening it always reads them afresh), and on its own every few minutes.
	var NOTIF_MIN_GAP_MS = 60 * 1000;
	var NOTIF_POLL_MS = 5 * 60 * 1000;

	var oNotifTime = DateFormat.getDateTimeInstance({ pattern: "d MMM yyyy, HH:mm" });

	// Side navigation key -> route. Utilisation is a tab of Timesheet reporting.
	var mKeyToRoute = {
		home: "home",
		timesheet: "timesheet",
		leave: "leave",
		teamcal: "teamcal",
		policies: "policies",
		explorer: "explorer",
		sickness: "sickness",
		documents: "documents",
		timesheetreport: "timesheetreport",
		utilisation: "timesheetreport",
		resources: "resources",
		clients: "clients",
		projects: "projects"
	};

	// Topbar title per route, so the page name appears once in the shell rather than
	// again inside every page.
	var mRouteToTitleKey = {
		home: "navHome",
		timesheet: "navTimesheet",
		leave: "navLeave",
		teamcal: "navTeamCalendar",
		resources: "navManageResources",
		clients: "navManageClients",
		projects: "navManageProjects",
		missingtimesheets: "navMissingTimesheets",
		sickness: "navSickness",
		timesheetreport: "navTimesheetReport",
		policies: "navPolicies",
		documents: "navDocuments",
		explorer: "navAppExplorer",
		admin: "navAdmin"
	};

	// The pages with an action in the top bar, as the design has them. Pressing it
	// calls the page controller's onPageAction (or, for a refresh, its onRefresh).
	// Driven off the route rather than off whichever page the NavContainer reports,
	// which during a transition is still the page being left behind.
	var mRouteToPageAction = {
		sickness: { textKey: "pageActionRecordSickness", icon: "sap-icon://add" },
		documents: { textKey: "pageActionUploadDocument", icon: "sap-icon://upload" },
		timesheetreport: { textKey: "pageActionRefresh", icon: "sap-icon://refresh" }
	};

	// Which nav row to light up for pages that have none of their own: Missing
	// timesheets and the Admin page are opened from the App Explorer.
	var mRouteToNavKey = {
		missingtimesheets: "explorer",
		admin: "explorer"
	};

	return Controller.extend("bsx.hrx.hrx2026.controller.App", {

		formatter: formatter,

		onInit: function () {
			var oToolPage = this.byId("toolPage");
			// start expanded on desktop, collapsed on smaller screens
			oToolPage.setSideExpanded(Device.resize.width > 1024);
			this._updateNavToggleIcon(oToolPage.getSideExpanded());

			this.getOwnerComponent().getRouter().attachRouteMatched(this._onRouteMatched, this);

			// Each row of the rail carries its key in the DOM (data-nav-key), so the
			// stylesheet can draw the design's own line icon for it.
			this.byId("sideNavigation").getItem().addEventDelegate({
				onAfterRendering: this._markNavigationRows.bind(this)
			});
		},

		_markNavigationRows: function () {
			var oNavList = this.byId("sideNavigation").getItem();
			var aItems = [];
			oNavList.getItems().forEach(function (oItem) {
				aItems = aItems.concat(oItem.isA("sap.tnt.NavigationListGroup") ? oItem.getItems() : [oItem]);
			});
			aItems.forEach(function (oItem) {
				var oRow = oItem.getDomRef();
				if (oRow) {
					oRow.setAttribute("data-nav-key", oItem.getKey());
				}
			});
		},

		/**
		 * Fills in who is signed in. The health strip's own figures come from the home
		 * page's own fetch instead - see setHealthStrip - rather than a second fetch of
		 * the same week/leave/approvals data here.
		 */
		_loadShell: function () {
			var oComponent = this.getOwnerComponent();
			var oModel = oComponent.getModel("app");

			// Component.init() already seeded this before routing started, so this -
			// and every routed page that needs the profile on its very first match,
			// the home page above all - shares the same resolution instead of each
			// racing to look the profile up on its own.
			var pUser = oComponent._pProfile;

			Promise.all([pUser, oModel.dataLoaded()]).then(function (aResult) {
				var oProfile = aResult[0];

				oModel.setProperty("/demoRole", CurrentUser.demoRole());
				oModel.setProperty("/user", {
					name: oProfile.name,
					initials: oProfile.initials,
					email: oProfile.email,
					empID: oProfile.empID,
					pic: oProfile.pic || "",
					isManager: oProfile.isManager,
					// "Consultant · BSX000052", as under the name in the design
					subtitle: [oProfile.jobTitle, oProfile.empID].filter(Boolean).join(" · ")
				});

				this._showAdminNavigation(!!oProfile.isManager);

				this._oNotifProfile = oProfile;
				this._loadNotifications(true);
				setInterval(this._loadNotifications.bind(this, true), NOTIF_POLL_MS);
			}.bind(this));
		},

		/**
		 * The "Admin only" group is for managers. It is taken out of the list rather
		 * than hidden, and put back if the profile changes.
		 * @param {boolean} bShow whether the signed-in user may see the admin pages
		 */
		_showAdminNavigation: function (bShow) {
			var oNavList = this.byId("sideNavigation").getItem();
			var oAdminGroup = this.byId("adminNavGroup");
			var bInList = oNavList.indexOfItem(oAdminGroup) !== -1;

			if (bShow && !bInList) {
				oNavList.addItem(oAdminGroup);
			} else if (!bShow && bInList) {
				oNavList.removeItem(oAdminGroup);
				// Kept as a dependent so it is destroyed with the view, not orphaned.
				this.getView().addDependent(oAdminGroup);
			}
		},

		/* =========================================================== */
		/* notifications                                               */
		/* =========================================================== */

		/**
		 * Works the signed-in user's notifications out again and keeps the unread
		 * ones in app>/notif.
		 * @param {boolean} [bForce] read even if the last read was moments ago
		 * @returns {Promise} resolved once the bell is up to date
		 */
		_loadNotifications: function (bForce) {
			var oProfile = this._oNotifProfile;
			var oModel = this.getOwnerComponent().getModel("app");
			var iNow = Date.now();

			if (!oProfile || (!bForce && this._iNotifAt && iNow - this._iNotifAt < NOTIF_MIN_GAP_MS)) {
				return Promise.resolve();
			}
			this._iNotifAt = iNow;
			var iLoad = this._iNotifLoad = (this._iNotifLoad || 0) + 1;

			oModel.setProperty("/notif/loading", true);
			return NotificationService.load(oProfile).then(function (aItems) {
				if (iLoad !== this._iNotifLoad) {
					return;
				}
				this._aNotifs = aItems;
				this._renderNotifications();
			}.bind(this)).catch(function (oError) {
				console.error("Notifications failed", oError);
			}).then(function () {
				oModel.setProperty("/notif/loading", false);
			});
		},

		_renderNotifications: function () {
			var oModel = this.getOwnerComponent().getModel("app");
			var sEmpId = (this._oNotifProfile || {}).empID;
			var aRead = NotificationService.readIds(sEmpId).concat(this._aNotifReadHere || []);
			var aItems = Notifications.unread(this._aNotifs || [], aRead).map(this._toNotification, this);

			oModel.setProperty("/notif/items", aItems);
			oModel.setProperty("/notif/countText", aItems.length ? this.getText("notifUnread", [aItems.length]) : "");
		},

		/**
		 * @param {object} oItem a notification from Notifications.js
		 * @returns {object} it with the subject, detail and time to show
		 */
		_toNotification: function (oItem) {
			var fnDates = function (sFrom, sTo) {
				return sFrom === sTo ? formatter.date(sFrom) : formatter.dateRange(sFrom, sTo);
			};
			var sSubject;
			var sDetail = "";

			switch (oItem.kind) {
				case "leaveApproved":
					sSubject = this.getText("notifLeaveApproved", [fnDates(oItem.from, oItem.to)]);
					sDetail = oItem.type;
					break;
				case "leaveRejected":
					sSubject = this.getText("notifLeaveRejected", [fnDates(oItem.from, oItem.to)]);
					sDetail = oItem.note ? this.getText("notifNote", [oItem.note]) : oItem.type;
					break;
				case "timesheet":
					sSubject = this.getText("notifTimesheet", [Math.round(oItem.minutes / 60 * 10) / 10]);
					break;
				case "document":
					sSubject = this.getText("notifDocument", [oItem.name]);
					break;
				case "approvals":
					sSubject = this.getText(oItem.count === 1 ? "notifApprovalsOne" : "notifApprovals", [oItem.count]);
					break;
				default:
					sSubject = oItem.subject || "";
					sDetail = oItem.detail || "";
			}

			return Object.assign({}, oItem, {
				subject: sSubject,
				detail: sDetail,
				when: oItem.at && !isNaN(oItem.at) ? oNotifTime.format(oItem.at) : ""
			});
		},

		onBellPress: function (oEvent) {
			var oBell = oEvent.getSource();

			if (!this._pNotifPopover) {
				this._pNotifPopover = Fragment.load({
					id: this.getView().getId(),
					name: "bsx.hrx.hrx2026.fragment.NotificationsPopover",
					controller: this
				}).then(function (oPopover) {
					this.getView().addDependent(oPopover);
					return oPopover;
				}.bind(this));
			}
			this._pNotifPopover.then(function (oPopover) {
				if (oPopover.isOpen()) {
					oPopover.close();
					return;
				}
				oPopover.openBy(oBell);
				this._loadNotifications(true);
			}.bind(this));
		},

		/**
		 * Marks the notification read and opens the page it is about.
		 * @param {sap.ui.base.Event} oEvent the list item press event
		 */
		onNotificationPress: function (oEvent) {
			var oItem = oEvent.getSource().getBindingContext("app").getObject();
			this._markNotificationsRead([oItem.id]);
			this.onNotificationsClose();
			if (oItem.route) {
				this.getOwnerComponent().getRouter().navTo(oItem.route);
			}
		},

		onNotificationsMarkAll: function () {
			this._markNotificationsRead((this.getOwnerComponent().getModel("app").getProperty("/notif/items") || [])
				.map(function (oItem) {
					return oItem.id;
				}));
		},

		onNotificationsClose: function () {
			if (this._pNotifPopover) {
				this._pNotifPopover.then(function (oPopover) {
					oPopover.close();
				});
			}
		},

		_markNotificationsRead: function (aIds) {
			// Kept here as well, so read holds for this page even where the browser
			// will not store it.
			this._aNotifReadHere = (this._aNotifReadHere || []).concat(aIds);
			NotificationService.markRead((this._oNotifProfile || {}).empID, aIds);
			this._renderNotifications();
		},

		/**
		 * Called by the home page once it has loaded the week, leave and approvals data
		 * the strip summarises, so the numbers come from that one fetch rather than the
		 * shell fetching the same data again for itself.
		 * @param {Array<object>} aStrip the strip entries
		 */
		setHealthStrip: function (aStrip) {
			this.getOwnerComponent().getModel("app").setProperty("/healthStrip", aStrip);
			this._refreshStripVisibility();
		},

		getResourceBundle: function () {
			return this.getOwnerComponent().getModel("i18n").getResourceBundle();
		},

		getText: function (sKey, aArgs) {
			return this.getResourceBundle().getText(sKey, aArgs);
		},

		/**
		 * Reflects the route in the shell title and the side navigation selection.
		 * @param {sap.ui.base.Event} oEvent the routeMatched event
		 */
		_onRouteMatched: function (oEvent) {
			// Leaving a page is when its notifications may have changed (a timesheet
			// booked, a policy acknowledged) - at most once a minute.
			this._loadNotifications(false);

			this._loadShell();
			
			var sRoute = oEvent.getParameter("name");
			var sKey = mRouteToTitleKey[sRoute];
			if (!sKey) {
				return;
			}

			this._sRoute = sRoute;

			// Timesheet reporting opened as Utilisation (?tab=util) is the design's
			// Utilisation page: its own title, and no "Last refreshed" stamp.
			var oQuery = (oEvent.getParameter("arguments") || {})["?query"] || {};
			var bUtilisation = sRoute === "timesheetreport" && oQuery.tab === "util";

			// The app catalogue arrives asynchronously and replaces the whole model, so
			// the title is written once that has landed. Setting it earlier leaves a
			// deep link showing whatever title the catalogue was seeded with.
			var oModel = this.getOwnerComponent().getModel("app");
			oModel.dataLoaded().then(function () {
				oModel.setProperty("/page", {
					title: this.getText(bUtilisation ? "navUtilisation" : sKey),
					// A page that reported when its data was read keeps showing it on return.
					stamp: bUtilisation ? "" : oModel.getProperty("/stamps/" + sRoute) || ""
				});
				this._refreshStripVisibility();
			}.bind(this));

			var oNavList = this.byId("sideNavigation").getItem();
			if (oNavList) {
				oNavList.setSelectedKey(bUtilisation ? "utilisation" : (mRouteToNavKey[sRoute] || sRoute));
			}
		},

		/**
		 * The strip reports on the signed-in user's own week, so it is shown on the home
		 * page and nowhere else.
		 */
		_refreshStripVisibility: function () {
			var oModel = this.getOwnerComponent().getModel("app");
			var aStrip = oModel.getProperty("/healthStrip") || [];

			var oAction = mRouteToPageAction[this._sRoute];

			oModel.setProperty("/page/showStrip", this._sRoute === "home" && aStrip.length > 0);
			oModel.setProperty("/page/action", oAction ? { text: this.getText(oAction.textKey), icon: oAction.icon } : null);
		},

		/**
		 * Read at press time rather than on the route match: the NavContainer is still
		 * transitioning when the route fires, so the page it reports then is the one
		 * being left behind.
		 * @returns {sap.ui.core.mvc.Controller|null} the controller of the page on screen
		 */
		_currentPageController: function () {
			var oPage = this.byId("appNavContainer").getCurrentPage();
			var oController = oPage && oPage.getController && oPage.getController();

			return oController || null;
		},

		/**
		 * The top bar's page action. The button lives on the shell's bar, so it asks
		 * the page on screen: its onPageAction, or for a refresh its onRefresh.
		 */
		onPageAction: function () {
			var oController = this._currentPageController();
			if (!oController) {
				return;
			}
			if (typeof oController.onPageAction === "function") {
				oController.onPageAction();
			} else if (typeof oController.onRefresh === "function") {
				oController.onRefresh();
			}
		},

		/**
		 * Shows who is signed in. The rail no longer repeats the name, so this is where
		 * the details live.
		 * @param {sap.ui.base.Event} oEvent the avatar press event
		 */
		onProfilePress: function (oEvent) {
			var oAvatar = oEvent.getSource();

			if (!this._pProfilePopover) {
				this._pProfilePopover = Fragment.load({
					id: this.getView().getId(),
					name: "bsx.hrx.hrx2026.fragment.ProfilePopover",
					controller: this
				}).then(function (oPopover) {
					this.getView().addDependent(oPopover);
					return oPopover;
				}.bind(this));
			}

			this._pProfilePopover.then(function (oPopover) {
				oPopover.openBy(oAvatar);
			});
		},

		/**
		 * TESTING AID - switches the "View as (demo)" role; the page reloads under it.
		 * @param {sap.ui.base.Event} oEvent the select's change event
		 */
		onDemoRoleChange: function (oEvent) {
			CurrentUser.setDemoRole(oEvent.getParameter("selectedItem").getKey());
		},

		onMenuButtonPress: function () {
			var oToolPage = this.byId("toolPage");
			var bExpanded = !oToolPage.getSideExpanded();
			oToolPage.setSideExpanded(bExpanded);
			this._updateNavToggleIcon(bExpanded);
		},

		/**
		 * Collapsed, the toggle sits alone at the top of the narrow rail with no room
		 * for the wordmark, so it reads as the menu opener rather than a "back" arrow.
		 * @param {boolean} bExpanded the side rail's new expanded state
		 */
		_updateNavToggleIcon: function (bExpanded) {
			this.byId("navToggleButton").setIcon(bExpanded ? "sap-icon://navigation-left-arrow" : "sap-icon://menu2");
			this.byId("toolPage").toggleStyleClass("hrxSideCollapsed", !bExpanded);
		},

		onItemSelect: function (oEvent) {
			var sKey = oEvent.getParameter("item").getKey();
			var oRouter = this.getOwnerComponent().getRouter();

			if (sKey === "utilisation") {
				oRouter.navTo("timesheetreport", { "?query": { tab: "util" } });
				return;
			}
			if (sKey === "timesheetreport") {
				oRouter.navTo("timesheetreport", { "?query": { tab: "assign" } });
				return;
			}
			oRouter.navTo(mKeyToRoute[sKey] || "home");
		}
	});
});
