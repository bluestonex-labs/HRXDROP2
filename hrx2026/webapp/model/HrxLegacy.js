sap.ui.define([
	"./Hrx",
	"./HrxTime",
	"./HrxServices",
	"./HrxLegacyClients",
	"./HrxLegacyProjects"
], function (Hrx, HrxTime, HrxServices, HrxLegacyClients, HrxLegacyProjects) {
	"use strict";

	/*
	 * The answers the pages were written against, rebuilt from the HRX service.
	 *
	 * The app grew up on xsjs commands (timesheet.xsjs?cmd=fetch and so on) and an
	 * OData V2 service (services.xsodata), and every page reads their response shapes.
	 * Rather than rewrite each page around the HRX entity model, Backend hands each
	 * call to {@link handle} (xsjs) or {@link read} (OData), which answer from /hrx in
	 * the shape the page already expects. Anything not answered here - client SLAs,
	 * licensed apps, attachments, tasks - still goes to the original services.
	 *
	 * Mapping notes, kept in one place:
	 *  - Keys: an employee is Users.EmployeeID; a client, project, site or billing
	 *    scheme is its GUID. Clients behind internal (INT) projects carry the legacy
	 *    internal-client key so My Timesheet still pins them.
	 *  - Leave types: the pages key them by code (HOLIL, SICKL...); /hrx by GUID. The
	 *    codes are derived from the type's description and mapped back on writes.
	 *  - Leave status: see leaveStatus.
	 *  - Flags: the pages use "Y"/"N"; /hrx uses booleans.
	 */

	var INTERNAL_CLIENT = "BSXCL0000000001";
	var DEFAULT_DAY_MINUTES = 8 * 60;

	// Leave type codes the pages colour and count by, from the type's description.
	var LEAVE_CODES = [
		{ code: "HOLIL", match: /holiday|annual/i },
		{ code: "SICKL", match: /sick/i },
		{ code: "UNPDL", match: /unpaid/i },
		{ code: "COMPL", match: /compassion|bereave/i },
		{ code: "MATEL", match: /matern/i },
		{ code: "PATEL", match: /patern/i }
	];

	/*
	 * How a leave row's state is read: from Leaves.Status_ID, which is where the HRX
	 * service records it (see HrxTime.LEAVE_STATUS) - actionOnLeave changes Status_ID
	 * and never WFFlag. Only a row without a known status falls back to the request
	 * itself: no approval needed means approved; otherwise WFFlag, which the hrx2023
	 * app set to true to approve and false to reject.
	 */
	var LEAVE_STATUS_IDS = {};
	LEAVE_STATUS_IDS[HrxTime.LEAVE_STATUS.approved] = "APR";
	LEAVE_STATUS_IDS[HrxTime.LEAVE_STATUS.requested] = "REQ";
	LEAVE_STATUS_IDS[HrxTime.LEAVE_STATUS.rejected] = "REJ";

	var STATUS_TEXT = { APR: "Approved", REQ: "Requested", REJ: "Rejected" };
	var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	var SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	var DAY_FLAGS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

	/* ----------------------------------------------------------------- */
	/* small helpers                                                     */
	/* ----------------------------------------------------------------- */

	function iso(oDate) {
		return oDate.getFullYear() + "-" + String(oDate.getMonth() + 1).padStart(2, "0") + "-" +
			String(oDate.getDate()).padStart(2, "0");
	}

	function parseDay(sDay) {
		var a = String(sDay).slice(0, 10).split("-");
		return new Date(+a[0], +a[1] - 1, +a[2]);
	}

	function eachDay(sFrom, sTo) {
		var aDays = [];
		if (!sFrom || !sTo) {
			return aDays;
		}
		var oDay = parseDay(sFrom);
		while (iso(oDay) <= sTo) {
			aDays.push(new Date(oDay.getTime()));
			oDay.setDate(oDay.getDate() + 1);
		}
		return aDays;
	}

	function hhmmss(iMinutes) {
		return Hrx.toTime(iMinutes);
	}

	function hhmm(iMinutes) {
		return hhmmss(iMinutes).slice(0, 5);
	}

	function yn(bValue) {
		return bValue ? "Y" : "N";
	}

	function isYes(vValue) {
		return vValue === true || vValue === "Y" || vValue === "y" || vValue === "true";
	}

	function blank(vValue) {
		return vValue === null || vValue === undefined || vValue === "None" ? "" : vValue;
	}

	function ok(oPayload, sMessage) {
		return Object.assign({ msgType: "S", msg: sMessage || "" }, oPayload);
	}

	function displayDate(oDate) {
		return SHORT_DAYS[oDate.getDay()] + ", " + oDate.getDate() + " " + MONTHS[oDate.getMonth()] + " " + oDate.getFullYear();
	}

	function lower(sValue) {
		return String(sValue || "").toLowerCase();
	}

	/* ----------------------------------------------------------------- */
	/* shared reads                                                      */
	/* ----------------------------------------------------------------- */

	var Data = {

		users: function () {
			return Hrx.list("Users", { $expand: "WorkSchedule" });
		},

		userByEmail: function (sEmail) {
			return Data.users().then(function (aUsers) {
				return aUsers.filter(function (oUser) {
					return lower(oUser.WorkEmail) === lower(sEmail);
				})[0] || null;
			});
		},

		userById: function (sEmpId) {
			return Data.users().then(function (aUsers) {
				return aUsers.filter(function (oUser) {
					return oUser.EmployeeID === sEmpId;
				})[0] || null;
			});
		},

		leaveTypes: function () {
			return Hrx.list("LeaveType").then(function (aTypes) {
				return aTypes.map(function (oType) {
					var oCode = LEAVE_CODES.filter(function (oEntry) {
						return oEntry.match.test(oType.LeaveCategoryDesc || "");
					})[0];
					return {
						ID: oType.ID,
						code: oCode ? oCode.code : oType.ID,
						desc: oType.LeaveCategoryDesc || "",
						accountable: oType.isAccountable !== false && !!oCode && oCode.code === "HOLIL" ? true : oType.isAccountable === true
					};
				});
			});
		},

		bankHolidays: function (sFrom, sTo) {
			return Hrx.list("BankHolidays", {
				$filter: "Date ge " + sFrom + " and Date le " + sTo
			});
		},

		leavesOf: function (sEmpId, sFrom, sTo) {
			var aFilter = [];
			if (sEmpId) {
				aFilter.push("EmpID_EmployeeID eq " + Hrx.literal(sEmpId));
			}
			if (sFrom && sTo) {
				aFilter.push("StartDate le " + sTo + " and EndDate ge " + sFrom);
			}
			return Hrx.list("Leaves", aFilter.length ? { $filter: aFilter.join(" and ") } : {});
		},

		sites: function () {
			return Hrx.list("Sites", { $select: "ID,SiteDesc" });
		},

		internalClients: function (aProjects) {
			var mInternal = {};
			aProjects.forEach(function (oProject) {
				if (String(oProject.ProjectType || "").toUpperCase() === "INT" && oProject.ClientID_ID) {
					mInternal[oProject.ClientID_ID] = true;
				}
			});
			return mInternal;
		}
	};

	/** A person's working days (index by getDay) and minutes in a working day. */
	function scheduleOf(oUser) {
		var oSchedule = oUser && oUser.WorkSchedule;
		var aWorks = DAY_FLAGS.map(function (sFlag, iDay) {
			return oSchedule ? oSchedule[sFlag] === true : iDay >= 1 && iDay <= 5;
		});
		var iDays = aWorks.filter(Boolean).length || 5;
		var iWeek = HrxTime.minutes((oSchedule && oSchedule.TargetHrsPerWeek) || (oUser && oUser.TargetHrsPerWeek)) || 40 * 60;
		return { works: aWorks, dayMinutes: iWeek / iDays || DEFAULT_DAY_MINUTES, weekMinutes: iWeek };
	}

	function isHalf(sDayTime) {
		return /^(AM|PM)$/i.test(String(sDayTime || "").trim());
	}

	/**
	 * A leave row's state as the pages know it.
	 * @param {object} oLeave a Leaves row
	 * @returns {string} "APR", "REQ" or "REJ"
	 */
	function leaveStatus(oLeave) {
		if (oLeave.Status_ID && LEAVE_STATUS_IDS[oLeave.Status_ID]) {
			return LEAVE_STATUS_IDS[oLeave.Status_ID];
		}
		if (oLeave.ApprovalRequired === false) {
			return "APR";
		}
		if (oLeave.WFFlag === true) {
			return "APR";
		}
		if (oLeave.WFFlag === false) {
			return "REJ";
		}
		return "REQ";
	}

	/** The working days a leave row covers within a range, as per-day entries. */
	function leaveDays(oLeave, sFrom, sTo, oSchedule, mHolidays) {
		var sStart = oLeave.StartDate > sFrom ? oLeave.StartDate : sFrom;
		var sEnd = oLeave.EndDate < sTo ? oLeave.EndDate : sTo;
		var bHalf = isHalf(oLeave.DayTime);

		return eachDay(sStart, sEnd).filter(function (oDay) {
			return oSchedule.works[oDay.getDay()] && !mHolidays[iso(oDay)];
		}).map(function (oDay) {
			return {
				date: iso(oDay),
				day: oDay,
				minutes: oSchedule.dayMinutes * (bHalf ? 0.5 : 1),
				absence: bHalf ? String(oLeave.DayTime).toUpperCase() : "Full Day"
			};
		});
	}

	function holidaysFor(aHolidays, sSiteId) {
		var mHolidays = {};
		aHolidays.forEach(function (oHoliday) {
			if (!oHoliday.Site_ID || !sSiteId || oHoliday.Site_ID === sSiteId) {
				mHolidays[oHoliday.Date] = oHoliday;
			}
		});
		return mHolidays;
	}

	/** A user's picture (SAP Document Management), or "" for none - the page then shows initials. */
	function pictureOf(oUser) {
		return oUser ? Hrx.pictureUrl(oUser.ImageRootID, oUser.ImageObjectID) : "";
	}

	/**
	 * A picture chosen on a page arrives as a data: url; anything else (an existing
	 * picture's url, or nothing) is not a new picture.
	 */
	function newPicture(sPic) {
		return typeof sPic === "string" && /^data:image\//.test(sPic);
	}

	function savePicture(sObjectType, sObjectId, sCurrentId, sDataUrl) {
		var sExtension = (/^data:image\/(\w+)/.exec(sDataUrl) || [])[1] || "png";
		return fetch(sDataUrl).then(function (oResponse) {
			return oResponse.blob();
		}).then(function (oBlob) {
			return Hrx.upload(sObjectType, sObjectId, sCurrentId, oBlob, "picture." + (sExtension === "jpeg" ? "jpg" : sExtension));
		});
	}

	/*
	 * A client's location: the service keeps a site's ID in Clients.BaseSite, the page
	 * shows and edits a name. Reads turn a site ID into its name; writes turn a name that
	 * is a site's back into its ID (any other text is kept as typed).
	 */
	function locationName(sBaseSite, aSites) {
		var oSite = (aSites || []).filter(function (oCandidate) {
			return oCandidate.ID === sBaseSite;
		})[0];
		return oSite ? oSite.SiteDesc || "" : (sBaseSite || "");
	}

	function locationKey(sLocation) {
		var sText = String(sLocation || "").trim();
		if (!sText) {
			return Promise.resolve(null);
		}
		return Data.sites().then(function (aSites) {
			var oSite = aSites.filter(function (oCandidate) {
				return oCandidate.ID === sText || lower(oCandidate.SiteDesc) === lower(sText);
			})[0];
			return oSite ? oSite.ID : sText.slice(0, 40);
		});
	}

	function fullName(oUser) {
		return oUser ? ((oUser.FirstName || "") + " " + (oUser.LastName || "")).trim() || oUser.WorkEmail || oUser.EmployeeID : "";
	}

	/* ----------------------------------------------------------------- */
	/* OData V2 entity sets                                              */
	/* ----------------------------------------------------------------- */

	function resourceRow(oUser) {
		var oSchedule = oUser.WorkSchedule || {};
		var oRow = {
			ID: oUser.EmployeeID,
			UserID: oUser.EmployeeID,
			OrgID: oUser.OrgID_ID || "",
			FName: oUser.FirstName || "",
			LName: oUser.LastName || "",
			Email: lower(oUser.WorkEmail),
			Mobile: oUser.MobileNo || "",
			EmpID: oUser.EmployeeID,
			UserTypeKey: oUser.UserType || "S",
			JobTitle: oUser.JobTitle || "",
			BaseSiteKey: oUser.BaseSite_ID || "",
			ManagerID: oUser.Manager_EmployeeID || "",
			Pic: pictureOf(oUser),
			PicB: null,
			IsActive: yn(oUser.IsActive !== false),
			TargetUtilization: oSchedule.TargetUtilization || oUser.TargetUtilization || "",
			AnnualLeaveQuota: oSchedule.AnnualLeaveQuota || "",
			TargetHrsPerWeek: oSchedule.TargetHrsPerWeek || oUser.TargetHrsPerWeek || "",
			BonusPercent: oUser.BonusPercent || 0,
			PensionRate: oUser.PercentRate || 0
		};
		DAY_FLAGS.forEach(function (sFlag, iDay) {
			oRow[sFlag] = yn(oUser.WorkSchedule ? oSchedule[sFlag] === true : iDay >= 1 && iDay <= 5);
		});
		return oRow;
	}

	var ENTITY_SETS = {

		Resources: function () {
			return Data.users().then(function (aUsers) {
				return aUsers.map(resourceRow);
			});
		},

		LeaveTypes: function () {
			return Data.leaveTypes().then(function (aTypes) {
				return aTypes.map(function (oType) {
					return { OrgID: "", LeaveCategoryId: oType.code, LeaveCategoryDesc: oType.desc };
				});
			});
		},

		sites: function () {
			return Hrx.list("Sites").then(function (aSites) {
				return aSites.map(function (oSite) {
					return { OrgID: oSite.OrgID_ID || "", SiteID: oSite.ID, SiteDesc: oSite.SiteDesc || "", SiteLocation: oSite.SiteLocation || "" };
				});
			});
		},

		UserTypes: function () {
			return Promise.resolve([
				{ OrgID: "", UserTypeKey: "S", UserTypeDesc: "Staff" },
				{ OrgID: "", UserTypeKey: "C", UserTypeDesc: "Contractor" }
			]);
		},

		Clients: function () {
			return Promise.all([
				Hrx.list("Clients"),
				Hrx.list("Contacts", { $filter: "ObjectType eq 'C'" }),
				Data.sites()
			]).then(function (aResults) {
				var aClients = aResults[0];
				var aContacts = aResults[1];
				var aSites = aResults[2];

				var mContacts = {};
				aContacts.forEach(function (oContact) {
					mContacts[oContact.ObjectID] = mContacts[oContact.ObjectID] || oContact;
				});
				return aClients.map(function (oClient) {
					var oContact = mContacts[oClient.ID] || {};
					return {
						OrgID: oClient.OrgID_ID || "",
						ClientKey: oClient.ID,
						ClientDesc: oClient.ClientName || "",
						ClientLocation: locationName(oClient.BaseSite, aSites),
						ClientLogo: Hrx.pictureUrl(oClient.LogoRootID, oClient.LogoObjectID),
						ClientContactName: ((oContact.FirstName || "") + " " + (oContact.LastName || "")).trim(),
						ClientContactEmail: oContact.WorkEmail || "",
						ClientContactMobile: oContact.MobileNo || oContact.ContactNo || ""
					};
				});
			});
		},

		ProjectsData: function () {
			return Promise.all([
				Hrx.list("Projects", { $expand: "ClientID($select=ID,ClientName,BaseSite)" }),
				Data.sites()
			]).then(function (aResults) {
				var aProjects = aResults[0];
				var aSites = aResults[1];
				return aProjects.map(function (oProject) {
					return {
						OrgID: oProject.OrgID_ID || "",
						ProjectKey: oProject.ID,
						ProjectDesc: oProject.ProjectDesc || "",
						ClientKey: oProject.ClientID_ID || "",
						ProjectTypeKey: oProject.ProjectType || "",
						StartDate: oProject.StartDate || null,
						EndDate: oProject.EndDate || null,
						PriorityKey: oProject.Priority || "",
						PONumber: oProject.PONumber || "",
						POValue: oProject.POValue || "",
						IsTimeBookingAllowed: yn(oProject.IsTimeBookingAllowed !== false),
						ProjectManagerID: oProject.ProjectManagerID || "",
						TotBillableDays: oProject.TotBillableDays || "",
						ClientDesc: (oProject.ClientID && oProject.ClientID.ClientName) || "",
						ClientLocation: locationName(oProject.ClientID && oProject.ClientID.BaseSite, aSites),
						PrimaryContactName: oProject.PrimaryContactName || "",
						PrimaryContactEmail: oProject.PrimaryContactEmail || "",
						SecondaryContactName: oProject.SecondaryContactName || "",
						SecondaryContactEmail: oProject.SecondaryContactEmail || ""
					};
				});
			});
		},

		ProjectTypes: function () {
			return Promise.resolve(HrxTime.PROJECT_TYPES.map(function (oType) {
				return { OrgID: "", ProjectTypeKey: oType.key, ProjectTypeDesc: oType.text };
			}));
		},

		Priorities: function () {
			return Promise.resolve([
				["P1", "Very High"], ["P2", "High"], ["P3", "Medium"], ["P4", "Low"], ["P5", "Very Low"]
			].map(function (a) {
				return { OrgID: "", PriorityKey: a[0], PriorityDesc: a[1] };
			}));
		},

		PredefinedBilling: function () {
			return Hrx.list("BillingScheme").then(function (aSchemes) {
				return aSchemes.map(function (oScheme) {
					return {
						BillingID: oScheme.ID,
						BillingDesc: oScheme.BillingDesc || "",
						DayRate: oScheme.DayRate || "0",
						Currency: oScheme.Currency || "GBP"
					};
				});
			});
		}
	};

	// The key each set is looked up by when a page reads one entity.
	var ENTITY_KEYS = {
		Resources: "EmpID",
		Clients: "ClientKey",
		ProjectsData: "ProjectKey"
	};

	/** Applies sap.ui.model.Filter objects to plain rows. OrgID is not filtered: /hrx is one organisation. */
	function matches(oRow, oFilter) {
		if (!oFilter) {
			return true;
		}
		var aNested = oFilter.aFilters || (oFilter.getFilters && oFilter.getFilters());
		if (aNested && aNested.length) {
			var bAnd = oFilter.bAnd === true || (oFilter.isAnd && oFilter.isAnd());
			return bAnd ? aNested.every(function (o) {
				return matches(oRow, o);
			}) : aNested.some(function (o) {
				return matches(oRow, o);
			});
		}
		var sPath = oFilter.sPath || (oFilter.getPath && oFilter.getPath());
		if (!sPath || sPath === "OrgID") {
			return true;
		}
		var sOperator = oFilter.sOperator || (oFilter.getOperator && oFilter.getOperator());
		var vExpected = oFilter.oValue1 !== undefined ? oFilter.oValue1 : (oFilter.getValue1 && oFilter.getValue1());
		var vActual = oRow[sPath];
		var bEqual = lower(vActual) === lower(vExpected);
		return sOperator === "NE" ? !bEqual : bEqual;
	}

	/* ----------------------------------------------------------------- */
	/* timesheet.xsjs                                                    */
	/* ----------------------------------------------------------------- */

	/**
	 * The assignments a person can book against, each carrying their time entries in
	 * the range - the "assignments" of timesheet.xsjs?cmd=fetch.
	 */
	function assignmentsOf(oUser, sFrom, sTo, bWithEntries) {
		return Promise.all([
			Hrx.list("UserToProject", {
				$filter: "Employee_EmployeeID eq " + Hrx.literal(oUser.EmployeeID),
				$expand: "Project($expand=ClientID($select=ID,ClientName)),BillingID($select=ID,BillingDesc)"
			}),
			bWithEntries ? Hrx.list("TimeLog", {
				$filter: "Employee_EmployeeID eq " + Hrx.literal(oUser.EmployeeID),
				$select: "ID,Date,Hours,Comment,Project_ID"
			}) : Promise.resolve([]),
			Hrx.list("Projects", { $select: "ID,ProjectType,ClientID_ID" })
		]).then(function (aResults) {
			var mInternal = Data.internalClients(aResults[2]);
			var mAllTime = {};
			var mInRange = {};

			aResults[1].forEach(function (oEntry) {
				mAllTime[oEntry.Project_ID] = (mAllTime[oEntry.Project_ID] || 0) + HrxTime.minutes(oEntry.Hours);
				if (oEntry.Date >= sFrom && oEntry.Date <= sTo) {
					(mInRange[oEntry.Project_ID] = mInRange[oEntry.Project_ID] || []).push({
						RecID: oEntry.ID,
						ProjectKey: oEntry.Project_ID,
						Date: oEntry.Date,
						Hours: oEntry.Hours || "00:00:00",
						Comment: oEntry.Comment || ""
					});
				}
			});

			var mSeen = {};
			return aResults[0].map(function (oRow) {
				var oProject = oRow.Project || {};
				var sClient = oProject.ClientID_ID || "";
				var bBillable = HrxTime.isBillable(oProject);
				var fDays = parseFloat(oRow.BillableDays) || 0;
				var bFirst = !mSeen[oRow.Project_ID];
				mSeen[oRow.Project_ID] = true;

				return {
					AssignmentID: [oRow.Employee_EmployeeID, oRow.Project_ID, oRow.BillingID_ID].join("|"),
					OrgID: oProject.OrgID_ID || "",
					EmpID: oRow.Employee_EmployeeID,
					ProjectID: oRow.Project_ID,
					ProjectDesc: oProject.ProjectDesc || "",
					PONo: oProject.PONumber || "",
					ClientKey: mInternal[sClient] ? INTERNAL_CLIENT : sClient,
					ClientDesc: (oProject.ClientID && oProject.ClientID.ClientName) || "",
					BillableDays: fDays,
					BillableHrs: fDays * 8,
					BillableMins: fDays * DEFAULT_DAY_MINUTES,
					ProjectTypeKey: oProject.ProjectType || "",
					ProjectTypeText: bBillable ? "Billable" : "Non-Billable",
					BillingID: oRow.BillingID_ID,
					Currency: oRow.Currency || "GBP",
					DayRate: oRow.DayRate || "0",
					EndDate: oRow.EndDate || null,
					IsActive: yn(oRow.IsActive !== false && oProject.IsActive !== false),
					StartDate: oRow.StartDate || null,
					TotalCharge: oRow.TotalCharge || "",
					TotalBilledMin: mAllTime[oRow.Project_ID] || 0,
					TotalBilledDays: (mAllTime[oRow.Project_ID] || 0) / DEFAULT_DAY_MINUTES,
					// Entries hang off one row per project, as the pages expect.
					TimeEntries: bFirst ? (mInRange[oRow.Project_ID] || []) : []
				};
			});
		});
	}

	var Timesheet = {

		fetch: function (oParams) {
			var sFrom = oParams.FromDate;
			var sTo = oParams.ToDate;

			return Data.userByEmail(oParams.Email).then(function (oUser) {
				if (!oUser) {
					throw new Error("No employee is held for " + oParams.Email + ".");
				}
				var oFirst = parseDay(sFrom);
				var sMonthFrom = iso(new Date(oFirst.getFullYear(), oFirst.getMonth(), 1));
				var sMonthTo = iso(new Date(oFirst.getFullYear(), oFirst.getMonth() + 1, 0));
				var sReadFrom = sFrom < sMonthFrom ? sFrom : sMonthFrom;
				var sReadTo = sTo > sMonthTo ? sTo : sMonthTo;

				return Promise.all([
					assignmentsOf(oUser, sFrom, sTo, true),
					Data.leavesOf(oUser.EmployeeID, sFrom, sTo),
					Data.bankHolidays(sReadFrom, sReadTo),
					Hrx.list("Users", { $filter: "Manager_EmployeeID eq " + Hrx.literal(oUser.EmployeeID), $select: "EmployeeID", $top: 1 })
				]).then(function (aResults) {
					var oSchedule = scheduleOf(oUser);
					var mHolidays = holidaysFor(aResults[2], oUser.BaseSite_ID);
					var aAssignments = aResults[0];

					var iWorkingDays = eachDay(sMonthFrom, sMonthTo).filter(function (oDay) {
						return oSchedule.works[oDay.getDay()] && !mHolidays[iso(oDay)];
					}).length;
					var fTargetPct = parseFloat((oUser.WorkSchedule && oUser.WorkSchedule.TargetUtilization) || oUser.TargetUtilization) || 0;

					var aLeaves = [];
					aResults[1].forEach(function (oLeave) {
						var sStatus = leaveStatus(oLeave);
						leaveDays(oLeave, sFrom, sTo, oSchedule, mHolidays).forEach(function (oDay) {
							aLeaves.push({ Date: oDay.date, Hours: hhmmss(oDay.minutes), StatusID: sStatus, Absence: oDay.absence });
						});
					});

					var aHolidays = Object.keys(mHolidays).filter(function (sDate) {
						return sDate >= sFrom && sDate <= sTo;
					}).map(function (sDate) {
						var oDay = parseDay(sDate);
						return {
							Date: sDate,
							Day: WEEKDAYS[oDay.getDay()],
							Hours: hhmmss(oSchedule.works[oDay.getDay()] ? oSchedule.dayMinutes : 0),
							Holiday: mHolidays[sDate].HolidayDesc || ""
						};
					});

					// Billable time booked in the month the week starts in.
					return Timesheet._monthBillable(oUser, sMonthFrom, sMonthTo, aAssignments).then(function (iMonthBillable) {
						return ok({
							user: {
								empID: oUser.EmployeeID,
								siteID: oUser.BaseSite_ID || "",
								isManager: yn(demoRole() === "admin" || (demoRole() !== "employee" && aResults[3].length > 0)),
								pic: pictureOf(oUser),
								targetHrsPerWeek: hhmm(oSchedule.weekMinutes),
								utilizationTargetPercentage: fTargetPct,
								utilizationTargetDays: Math.round(iWorkingDays * fTargetPct / 100),
								noOfWorkingDays: iWorkingDays,
								workSchedule: DAY_FLAGS.reduce(function (o, s, i) {
									o[WEEKDAYS[i]] = yn(oSchedule.works[i]);
									return o;
								}, {}),
								CurrentMonthActualBilledMinutes: iMonthBillable,
								CurrentMonthActualBilledHrs: iMonthBillable / 60,
								CurrentMonthActualBilledDays: iMonthBillable / DEFAULT_DAY_MINUTES
							},
							assignments: aAssignments,
							leaves: aLeaves,
							bankHolidays: aHolidays
						});
					});
				});
			});
		},

		_monthBillable: function (oUser, sFrom, sTo, aAssignments) {
			var mBillable = {};
			aAssignments.forEach(function (oAssignment) {
				if (oAssignment.ProjectTypeText === "Billable") {
					mBillable[oAssignment.ProjectID] = true;
				}
			});
			return HrxTime.timeLog(sFrom, sTo, oUser.EmployeeID).then(function (aLog) {
				return aLog.reduce(function (iTotal, oEntry) {
					return iTotal + (mBillable[oEntry.Project_ID] ? HrxTime.minutes(oEntry.Hours) : 0);
				}, 0);
			});
		},

		fetchAssignments: function (oParams) {
			return Data.userByEmail(oParams.Email).then(function (oUser) {
				if (!oUser) {
					throw new Error("No employee is held for " + oParams.Email + ".");
				}
				return assignmentsOf(oUser, oParams.FromDate, oParams.ToDate, false).then(function (aAssignments) {
					return ok({ assignments: aAssignments });
				});
			});
		},

		save: function (oBody) {
			var aEntries = (oBody.TimesheetListSet || []).map(function (oEntry) {
				var oRow = {
					Project_ID: oEntry.ProjectKey,
					Employee_EmployeeID: oBody.UserID,
					Date: oEntry.Date,
					Hours: (oEntry.Hours || "00:00:00").length === 5 ? oEntry.Hours + ":00" : (oEntry.Hours || "00:00:00"),
					Comment: oEntry.Comment || ""
				};
				if (oEntry.RecID) {
					oRow.ID = oEntry.RecID;
				}
				return oRow;
			});
			if (!aEntries.length) {
				return Promise.resolve(ok({}));
			}
			return Hrx.callAction("saveTimesheetEntry", { timeLog: aEntries }).then(function () {
				return ok({});
			});
		},

		"delete": function (oBody) {
			var aIds = (oBody.TimesheetListSet || []).filter(function (oEntry) {
				return oEntry.RecID;
			}).map(function (oEntry) {
				return { ID: oEntry.RecID };
			});
			if (!aIds.length) {
				return Promise.resolve(ok({}));
			}
			return Hrx.callAction("deleteTimesheetEntry", { deleteEntry: aIds }).then(function () {
				return ok({});
			});
		},

		missingTimesheet: function (oParams) {
			return Promise.all([
				HrxTime.compliance(oParams.fromDate, oParams.toDate),
				Data.users()
			]).then(function (aResults) {
				var aRows = aResults[0];
				var aUsers = aResults[1];

				var mUsers = {};
				aUsers.forEach(function (oUser) {
					mUsers[oUser.EmployeeID] = oUser;
				});
				return aRows.map(function (oRow) {
					var iMissing = Math.max(0, oRow.expectedMinutes - oRow.bookedMinutes);
					return {
						UserID: oRow.UserID,
						FName: oRow.FirstName,
						LName: oRow.LastName,
						Email: oRow.Email,
						Pic: pictureOf(mUsers[oRow.UserID]),
						UserTypeKey: oRow.UserTypeKey,
						BaseSiteKey: oRow.SiteID,
						ExpectedBookingInSecond: oRow.expectedMinutes * 60,
						ActualBookedInSecond: oRow.bookedMinutes * 60,
						MissingTimeInSecond: iMissing * 60,
						LeaveTakenInSeconds: oRow.leaveMinutes * 60,
						ExpectedBookingInHour: hhmmss(oRow.expectedMinutes),
						ActualBookedInHour: hhmmss(oRow.bookedMinutes),
						MissingTimeInHour: hhmmss(iMissing),
						LeaveTakenInHours: hhmmss(oRow.leaveMinutes)
					};
				});
			});
		}
	};

	/* ----------------------------------------------------------------- */
	/* leaveReqs.xsjs, leaveApprovals.xsjs, teamCalendar1.xsjs           */
	/* ----------------------------------------------------------------- */

	/** TESTING AID - the "View as (demo)" choice, from CurrentUser. */
	function demoRole() {
		var CurrentUser = sap.ui.require("bsx/hrx/hrx2026/model/CurrentUser");
		return CurrentUser ? CurrentUser.demoRole() : "actual";
	}

	function signedInEmpId() {
		var CurrentUser = sap.ui.require("bsx/hrx/hrx2026/model/CurrentUser");
		var oProfile = CurrentUser && CurrentUser.get();
		return (oProfile && oProfile.empID) || "";
	}

	/** The leave year: April to March, as the HRX service counts it (fetchUserLeave). */
	function leaveYear() {
		var oToday = new Date();
		var iYear = oToday.getMonth() < 3 ? oToday.getFullYear() - 1 : oToday.getFullYear();
		return { from: iYear + "-04-01", to: (iYear + 1) + "-03-31" };
	}

	var Leave = {

		fetchUser: function (oParams) {
			var oYear = leaveYear();

			return Promise.all([Data.users(), Data.leaveTypes()]).then(function (aResults) {
				var aUsers = aResults[0];
				var oUser = aUsers.filter(function (o) {
					return lower(o.WorkEmail) === lower(oParams.Email);
				})[0];
				if (!oUser) {
					throw new Error("No employee is held for " + oParams.Email + ".");
				}
				var oManager = aUsers.filter(function (o) {
					return o.EmployeeID === oUser.Manager_EmployeeID;
				})[0];
				var mTypes = {};
				aResults[1].forEach(function (oType) {
					mTypes[oType.ID] = oType;
				});

				return Promise.all([
					Data.leavesOf(oUser.EmployeeID),
					Data.bankHolidays(oYear.from, oYear.to)
				]).then(function (aMore) {
					var oSchedule = scheduleOf(oUser);
					var mHolidays = holidaysFor(aMore[1], oUser.BaseSite_ID);
					var aAvailed = [];
					var mAnalytics = {};
					var fUsed = 0;

					aMore[0].forEach(function (oLeave) {
						var oType = mTypes[oLeave.LeaveCategoryId_ID] || { code: "", desc: "", accountable: false };
						var sStatus = leaveStatus(oLeave);

						leaveDays(oLeave, oLeave.StartDate, oLeave.EndDate, oSchedule, mHolidays).forEach(function (oDay) {
							var fDays = oDay.absence === "Full Day" ? 1 : 0.5;
							aAvailed.push({
								LeaveID: oLeave.ID,
								// the days asked for together share one group (the service sets it)
								LeaveGrpID: oLeave.LeaveGrpID || "",
								Date: oDay.date,
								DisplayDate: displayDate(oDay.day),
								LeaveTypeID: oType.code,
								LeaveType: oType.desc,
								Absence: oDay.absence,
								Status: STATUS_TEXT[sStatus],
								StatusID: sStatus,
								RequesterComments: oLeave.RequesterComments || ""
							});
							if (sStatus !== "REJ" && oDay.date >= oYear.from && oDay.date <= oYear.to) {
								mAnalytics[oType.desc] = (mAnalytics[oType.desc] || 0) + fDays;
								if (oType.accountable) {
									fUsed += fDays;
								}
							}
						});
					});

					var fQuota = parseFloat(oUser.WorkSchedule && oUser.WorkSchedule.AnnualLeaveQuota) || 0;

					return ok({
						user: {
							empID: oUser.EmployeeID,
							name: fullName(oUser),
							email: lower(oUser.WorkEmail),
							siteID: oUser.BaseSite_ID || "",
							pic: pictureOf(oUser),
							managerID: oUser.Manager_EmployeeID || "",
							managerName: fullName(oManager),
							managerEmail: oManager ? lower(oManager.WorkEmail) : "",
							annualLeaveQuota: String(fQuota),
							noOfAvailedLeaves: String(fUsed),
							balanceLeaves: String(fQuota - fUsed)
						},
						availedLeaves: aAvailed.sort(function (a, b) {
							return b.Date.localeCompare(a.Date);
						}),
						bankHolidays: Object.keys(mHolidays).map(function (sDate) {
							return { Date: sDate, Holiday: mHolidays[sDate].HolidayDesc || "" };
						}),
						analyticsData: Object.keys(mAnalytics).map(function (sType) {
							return { LeaveType: sType, Days: String(mAnalytics[sType]) };
						})
					});
				});
			});
		},

		/**
		 * The bookable days in a range: working days that are not bank holidays and not
		 * already wholly on leave. A half-taken day offers its other half.
		 */
		getDates: function (oParams) {
			var sFrom = oParams.FromDate;
			var sTo = oParams.ToDate;

			return Data.userById(oParams.EmpID).then(function (oUser) {
				return Promise.all([
					Data.leavesOf(oParams.EmpID, sFrom, sTo),
					Data.bankHolidays(sFrom, sTo)
				]).then(function (aResults) {
					var oSchedule = scheduleOf(oUser);
					var mHolidays = holidaysFor(aResults[1], oParams.SiteID || (oUser && oUser.BaseSite_ID));
					var mTaken = {};

					aResults[0].forEach(function (oLeave) {
						if (leaveStatus(oLeave) === "REJ") {
							return;
						}
						leaveDays(oLeave, sFrom, sTo, oSchedule, mHolidays).forEach(function (oDay) {
							var sHalf = oDay.absence === "Full Day" ? "FULL" : oDay.absence;
							var sBefore = mTaken[oDay.date];
							mTaken[oDay.date] = !sBefore ? sHalf : (sBefore === sHalf ? sBefore : "FULL");
						});
					});

					var aDates = eachDay(sFrom, sTo).filter(function (oDay) {
						var sDate = iso(oDay);
						return oSchedule.works[oDay.getDay()] && !mHolidays[sDate] && mTaken[sDate] !== "FULL";
					}).map(function (oDay) {
						var sTaken = mTaken[iso(oDay)];
						return {
							date: iso(oDay),
							displayDate: displayDate(oDay),
							availableSlot: sTaken === "AM" ? "PM" : sTaken === "PM" ? "AM" : ""
						};
					});

					return ok({ dates: aDates });
				});
			});
		},

		/**
		 * One request per day, as the pages send them. A request on someone else's behalf,
		 * or one that needs no approval, goes through the team calendar action.
		 */
		requestLeave: function (oBody) {
			var aRows = oBody.LeaveReqSet || [];
			if (!aRows.length) {
				return Promise.resolve(ok({}));
			}

			return Data.leaveTypes().then(function (aTypes) {
				var mByCode = {};
				aTypes.forEach(function (oType) {
					mByCode[oType.code] = oType.ID;
					mByCode[oType.ID] = oType.ID;
				});
				var bOnBehalf = aRows.some(function (oRow) {
					return oRow.EmpID !== signedInEmpId() || oRow.ApprovalRequired === "N";
				});

				var aLog = aRows.map(function (oRow) {
					var oEntry = {
						EmpID_EmployeeID: oRow.EmpID,
						IsPaid: oRow.IsPaid !== "N",
						LeaveCategoryId_ID: mByCode[oRow.LeaveCategoryId] || oRow.LeaveCategoryId,
						// one row per day: the row's own length, not the request's
						NoOfDays: /^(AM|PM)$/i.test(oRow.DayTime) ? "0.5" : "1",
						StartDate: oRow.StartDate,
						EndDate: oRow.EndDate || oRow.StartDate,
						DayTime: oRow.DayTime || "Full Day",
						ApprovalRequired: oRow.ApprovalRequired !== "N",
						ApproverID_EmployeeID: oRow.ApproverID || null,
						RequesterComments: oRow.RequesterComments || "",
						WFFlag: null
					};
					return oEntry;
				});

				return Hrx.callAction(bOnBehalf ? "createLeaveRequestForTeamCalendar" : "createLeaveRequest", { userLog: aLog })
					.then(function () {
						return ok({});
					});
			});
		},

		update: function (oBody) {
			return Data.leaveTypes().then(function (aTypes) {
				var oType = aTypes.filter(function (o) {
					return o.code === oBody.LeaveType || o.ID === oBody.LeaveType;
				})[0];
				var oChange = {
					StartDate: oBody.Date,
					EndDate: oBody.Date,
					DayTime: oBody.Absence || "Full Day"
				};
				if (oType) {
					oChange.LeaveCategoryId_ID = oType.ID;
				}
				return Hrx.update("Leaves(" + oBody.LeaveID + ")", oChange).then(function () {
					return ok({});
				});
			});
		},

		"delete": function (oBody) {
			return Hrx.remove("Leaves(" + oBody.LeaveID + ")").then(function () {
				return ok({});
			});
		},

		pendingApproval: function (oParams) {
			return Promise.all([Data.users(), Data.leaveTypes()]).then(function (aResults) {
				var oMe = aResults[0].filter(function (o) {
					return lower(o.WorkEmail) === lower(oParams.Email);
				})[0];
				if (!oMe) {
					return ok({ leaveToApprove: [] });
				}
				var mUsers = {};
				aResults[0].forEach(function (o) {
					mUsers[o.EmployeeID] = o;
				});
				var mTypes = {};
				aResults[1].forEach(function (o) {
					mTypes[o.ID] = o;
				});

				// The signed-in manager's own team: requests they are the approver of, and
				// requests from anybody reporting to them - current staff only, as on Team
				// Calendar, so the two always list the same requests. (Everybody's pending
				// leave is on Team Calendar, under Team: Everyone.)
				return Hrx.list("Leaves", { $filter: "Status_ID eq " + HrxTime.LEAVE_STATUS.requested + " or Status_ID eq null" }).then(function (aLeaves) {
					var aPending = [];
					aLeaves.filter(function (oLeave) {
						var oRequester = mUsers[oLeave.EmpID_EmployeeID];
						var bMine = oLeave.ApproverID_EmployeeID === oMe.EmployeeID ||
							(!!oRequester && oRequester.Manager_EmployeeID === oMe.EmployeeID);
						var bCurrent = !oRequester || oRequester.IsActive !== false;
						return bMine && bCurrent && leaveStatus(oLeave) === "REQ";
					}).forEach(function (oLeave) {
						var oRequester = mUsers[oLeave.EmpID_EmployeeID];
						var oType = mTypes[oLeave.LeaveCategoryId_ID] || { code: "", desc: "" };
						var oSchedule = scheduleOf(oRequester);
						leaveDays(oLeave, oLeave.StartDate, oLeave.EndDate, oSchedule, {}).forEach(function (oDay) {
							aPending.push({
								LeaveID: oLeave.ID,
								RequesterID: oLeave.EmpID_EmployeeID,
								RequesterName: fullName(oRequester),
								RequesterEmail: oRequester ? lower(oRequester.WorkEmail) : "",
								LeaveType: oType.desc,
								LeaveTypeID: oType.code,
								Date: oDay.date,
								DisplayDate: displayDate(oDay.day),
								AbsenceType: oDay.absence,
								RequesterComments: oLeave.RequesterComments || "",
								Status: STATUS_TEXT.REQ,
								StatusID: "REQ"
							});
						});
					});
					return ok({ leaveToApprove: aPending });
				});
			});
		},

		action: function (oBody) {
			var mSeen = {};
			var aLog = [];
			(oBody.LeaveReqSet || []).forEach(function (oRow) {
				if (oRow.LeaveID && !mSeen[oRow.LeaveID]) {
					mSeen[oRow.LeaveID] = true;
					aLog.push({ ID: oRow.LeaveID, WFFlag: oRow.Status === "APR", ApproverComments: oRow.ApproverComments || "" });
				}
			});
			if (!aLog.length) {
				return Promise.resolve(ok({}));
			}
			return Hrx.callAction("actionOnLeave", { LeaveLog: aLog }).then(function () {
				return ok({});
			});
		},

		/**
		 * teamCalendar1.xsjs?cmd=team: who is signed in, and everybody's leave and bank
		 * holidays in the range.
		 */
		team: function (oParams) {
			var sFrom = oParams.FromDate;
			var sTo = oParams.ToDate;

			return Promise.all([
				Data.users(),
				Data.leaveTypes(),
				Data.leavesOf(null, sFrom, sTo),
				Data.bankHolidays(sFrom, sTo)
			]).then(function (aResults) {
				var aUsers = aResults[0];
				var oMe = aUsers.filter(function (o) {
					return lower(o.WorkEmail) === lower(oParams.Email);
				})[0];
				var mTypes = {};
				aResults[1].forEach(function (o) {
					mTypes[o.ID] = o;
				});
				var mLeaves = {};
				aResults[2].forEach(function (oLeave) {
					(mLeaves[oLeave.EmpID_EmployeeID] = mLeaves[oLeave.EmpID_EmployeeID] || []).push(oLeave);
				});

				var aTeam = aUsers.filter(function (o) {
					return o.IsActive !== false;
				}).map(function (oUser) {
					var oSchedule = scheduleOf(oUser);
					var mHolidays = holidaysFor(aResults[3], oUser.BaseSite_ID);
					var aLeave = [];

					(mLeaves[oUser.EmployeeID] || []).forEach(function (oLeave) {
						var oType = mTypes[oLeave.LeaveCategoryId_ID] || { code: "", desc: "" };
						var sStatus = leaveStatus(oLeave);
						if (sStatus === "REJ") {
							return;
						}
						leaveDays(oLeave, sFrom, sTo, oSchedule, mHolidays).forEach(function (oDay) {
							aLeave.push({
								LeaveID: oLeave.ID,
								Date: oDay.date,
								AbsenceType: oDay.absence === "Full Day" ? "" : oDay.absence,
								LeaveTypeID: oType.code,
								LeaveType: oType.desc,
								StatusID: sStatus,
								Status: STATUS_TEXT[sStatus],
								RequesterName: fullName(oUser),
								RequesterComments: oLeave.RequesterComments || ""
							});
						});
					});
					Object.keys(mHolidays).forEach(function (sDate) {
						if (oSchedule.works[parseDay(sDate).getDay()]) {
							aLeave.push({
								Date: sDate, AbsenceType: "", LeaveTypeID: "BANKHOLIDAY",
								LeaveType: mHolidays[sDate].HolidayDesc || "Bank holiday", StatusID: "APR", Status: STATUS_TEXT.APR
							});
						}
					});

					return {
						EmpID: oUser.EmployeeID,
						Name: fullName(oUser),
						JobTitle: oUser.JobTitle || "",
						Email: lower(oUser.WorkEmail),
						SiteID: oUser.BaseSite_ID || "",
						ManagerID: oUser.Manager_EmployeeID || "",
						UserType: oUser.UserType || "",
						Pic: pictureOf(oUser),
						IsLoggedinUser: yn(!!oMe && oMe.EmployeeID === oUser.EmployeeID),
						Leave: aLeave
					};
				});

				var CurrentUser = sap.ui.require("bsx/hrx/hrx2026/model/CurrentUser");
				var bManager = !!oMe && (aUsers.some(function (o) {
					return o.Manager_EmployeeID === oMe.EmployeeID;
				}) || !!(CurrentUser && CurrentUser.isManagerException(oMe.WorkEmail))) && demoRole() !== "employee";

				var oResult = {
					loggedinUser: oMe ? [{
						EmpID: oMe.EmployeeID,
						Name: fullName(oMe),
						Email: lower(oMe.WorkEmail),
						SiteID: oMe.BaseSite_ID || "",
						JobTitle: oMe.JobTitle || "",
						IsManager: yn(bManager),
						HasPendingLeaves: "N"
					}] : [],
					users: aTeam
				};

				if (!oMe || !bManager) {
					return ok(oResult);
				}
				return Leave.pendingApproval({ Email: oParams.Email }).then(function (oPending) {
					oResult.loggedinUser[0].HasPendingLeaves = yn(oPending.leaveToApprove.length > 0);
					return ok(oResult);
				});
			});
		}
	};

	/* ----------------------------------------------------------------- */
	/* manageUsers, manageClients, manageProjects, manageAssignments     */
	/* ----------------------------------------------------------------- */

	function orgId() {
		return Hrx.list("Organisations", { $select: "ID" }).then(function (aOrgs) {
			return aOrgs.length ? aOrgs[0].ID : null;
		});
	}

	function scheduleBody(oBody) {
		var oSchedule = {};
		DAY_FLAGS.forEach(function (sFlag) {
			if (oBody[sFlag] !== undefined) {
				oSchedule[sFlag] = isYes(oBody[sFlag]);
			}
		});
		if (oBody.AnnualLeaveQuota !== undefined) {
			oSchedule.AnnualLeaveQuota = String(oBody.AnnualLeaveQuota || "");
		}
		if (oBody.TargetUtilization !== undefined) {
			oSchedule.TargetUtilization = String(oBody.TargetUtilization || "");
		}
		if (oBody.TargetHrsPerWeek !== undefined) {
			oSchedule.TargetHrsPerWeek = String(oBody.TargetHrsPerWeek || "");
		}
		return oSchedule;
	}

	var Users = {

		update: function (oBody) {
			var sEmpId = oBody.EmpID || oBody.UserID;
			var oUser = {
				FirstName: oBody.FName,
				LastName: oBody.LName,
				WorkEmail: oBody.Email,
				MobileNo: oBody.Mobile || "",
				UserType: oBody.UserTypeKey,
				BaseSite_ID: oBody.BaseSiteKey || null,
				Manager_EmployeeID: oBody.ManagerID || null,
				TargetUtilization: String(oBody.TargetUtilization || ""),
				TargetHrsPerWeek: String(oBody.TargetHrsPerWeek || ""),
				BonusPercent: parseInt(oBody.BonusPercent, 10) || 0,
				PercentRate: parseInt(oBody.PensionRate, 10) || 0,
				IsActive: isYes(oBody.IsActive)
			};
			if (HrxServices.hasProperty("Users", "JobTitle") && oBody.JobTitle !== undefined) {
				oUser.JobTitle = oBody.JobTitle || "";
			}
			var sPath = "Users(" + Hrx.literal(sEmpId) + ")";

			return Hrx.update(sPath, oUser).then(function () {
				if (!newPicture(oBody.Pic)) {
					return null;
				}
				return Hrx.get(sPath, { $select: "ImageObjectID" }).then(function (oStored) {
					return savePicture("User", sEmpId, (oStored && oStored.ImageObjectID) || "", oBody.Pic);
				});
			}).then(function () {
				var oSchedule = scheduleBody(oBody);
				var sSchedule = "WorkSchedule(" + Hrx.literal(sEmpId) + ")";
				return Hrx.update(sSchedule, oSchedule).catch(function () {
					return Hrx.create("WorkSchedule", Object.assign({ EmployeeID_EmployeeID: sEmpId }, oSchedule));
				});
			}).then(function () {
				return ok({});
			});
		},

		"new": function (oBody) {
			return orgId().then(function (sOrgId) {
				return Hrx.create("Users", {
					OrgID_ID: sOrgId,
					FirstName: oBody.FName,
					LastName: oBody.LName,
					WorkEmail: oBody.Email,
					MobileNo: oBody.Mobile || "",
					UserType: oBody.UserTypeKey || "S",
					BaseSite_ID: oBody.BaseSiteKey || null,
					IsActive: true,
					WorkSchedule: { Mo: true, Tu: true, We: true, Th: true, Fr: true, Sa: false, Su: false }
				});
			}).then(function (oCreated) {
				var sEmpId = oCreated && oCreated.EmployeeID;
				return (sEmpId && newPicture(oBody.Pic) ? savePicture("User", sEmpId, "", oBody.Pic) : Promise.resolve()).then(function () {
					return ok({ EmpID: sEmpId });
				});
			});
		},

		/** A soft delete, as before: the person is made inactive, their records kept. */
		"delete": function (oBody) {
			return Hrx.update("Users(" + Hrx.literal(oBody.EmpID) + ")", { IsActive: false }).then(function () {
				return ok({});
			});
		},

		/** Makes a person active or inactive, and changes nothing else on their record. */
		setActive: function (oBody) {
			return Hrx.update("Users(" + Hrx.literal(oBody.EmpID) + ")", { IsActive: isYes(oBody.IsActive) }).then(function () {
				return ok({});
			});
		}
	};

	function saveContact(sClientId, oBody) {
		var oContact = {
			ContactType: "Primary",
			MobileNo: oBody.ClientContactMobile || "",
			WorkEmail: oBody.ClientContactEmail || "",
			IsActive: true
		};
		// The name is held once the HRX service has Contacts.FirstName / LastName:
		// everything up to the last space is the first name.
		var sName = String(oBody.ClientContactName || "").trim();
		var bNameHeld = HrxServices.hasProperty("Contacts", "FirstName");
		if (bNameHeld) {
			var iLastSpace = sName.lastIndexOf(" ");
			oContact.FirstName = iLastSpace > 0 ? sName.slice(0, iLastSpace) : sName;
			oContact.LastName = iLastSpace > 0 ? sName.slice(iLastSpace + 1) : "";
		}
		if (!oBody.ClientContactMobile && !oBody.ClientContactEmail && !(bNameHeld && sName)) {
			return Promise.resolve();
		}
		return Hrx.list("Contacts", { $filter: "ObjectType eq 'C' and ObjectID eq " + sClientId }).then(function (aContacts) {
			if (aContacts.length) {
				return Hrx.update("Contacts(ID=" + aContacts[0].ID + ",ObjectType='C')", oContact);
			}
			return Hrx.create("Contacts", Object.assign({ ID: newGuid(), ObjectType: "C", ObjectID: sClientId }, oContact));
		});
	}

	function newGuid() {
		if (window.crypto && window.crypto.randomUUID) {
			return window.crypto.randomUUID();
		}
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
			var r = Math.random() * 16 | 0;
			return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
		});
	}

	var Clients = {

		update: function (oBody) {
			return locationKey(oBody.ClientLocation).then(function (sBaseSite) {
				return Hrx.update("Clients(" + oBody.ClientKey + ")", {
					ClientName: oBody.ClientDesc,
					BaseSite: sBaseSite
				});
			}).then(function () {
				return saveContact(oBody.ClientKey, oBody);
			}).then(function () {
				if (!newPicture(oBody.ClientLogo)) {
					return null;
				}
				return Hrx.get("Clients(" + oBody.ClientKey + ")", { $select: "LogoObjectID" }).then(function (oStored) {
					return savePicture("Client", oBody.ClientKey, (oStored && oStored.LogoObjectID) || "", oBody.ClientLogo);
				});
			}).then(function () {
				return ok({});
			});
		},

		"new": function (oBody) {
			return Promise.all([orgId(), locationKey(oBody.ClientLocation)]).then(function (aResults) {
				var sOrgId = aResults[0];
				var sBaseSite = aResults[1];

				return Hrx.create("Clients", {
					OrgID_ID: sOrgId,
					ClientName: oBody.ClientDesc,
					BaseSite: sBaseSite,
					IsActive: true
				});
			}).then(function (oCreated) {
				return saveContact(oCreated.ID, oBody).then(function () {
					return newPicture(oBody.ClientLogo) ? savePicture("Client", oCreated.ID, "", oBody.ClientLogo) : null;
				}).then(function () {
					return ok({ ClientKey: oCreated.ID });
				});
			});
		}
	};

	function projectBody(oBody) {
		var oProject = {
			ProjectDesc: oBody.ProjectDesc,
			ProjectType: oBody.ProjectTypeKey,
			StartDate: oBody.StartDate || null,
			EndDate: oBody.EndDate || null,
			Priority: oBody.PriorityKey || null,
			PONumber: oBody.PONumber || "",
			POValue: String(oBody.POValue || ""),
			IsTimeBookingAllowed: isYes(oBody.IsTimeBookingAllowed),
			ProjectManagerID: oBody.ProjectManagerID || "",
			TotBillableDays: String(oBody.TotBillableDays || "")
		};
		return oProject;
	}

	var Projects = {

		update: function (oBody) {
			return Hrx.update("Projects(" + oBody.ProjectKey + ")", projectBody(oBody)).then(function () {
				return HrxLegacyProjects.Areas.saveProjectAreas(oBody.ProjectKey, oBody.ProjectTask);
			}).then(function () {
				return ok({});
			});
		},

		/** The client's primary and secondary contacts for the project (the service checks them). */
		saveContacts: function (oBody) {
			return Hrx.update("Projects(" + oBody.ProjectKey + ")", {
				PrimaryContactName: oBody.PrimaryContactName || "",
				PrimaryContactEmail: oBody.PrimaryContactEmail || "",
				SecondaryContactName: oBody.SecondaryContactName || "",
				SecondaryContactEmail: oBody.SecondaryContactEmail || ""
			}).then(function () {
				return ok({});
			});
		},

		"new": function (oBody) {
			return orgId().then(function (sOrgId) {
				return Hrx.create("Projects", Object.assign(projectBody(oBody), {
					OrgID_ID: sOrgId,
					ClientID_ID: oBody.ClientKey,
					IsActive: true
				}));
			}).then(function (oCreated) {
				return HrxLegacyProjects.Areas.saveProjectAreas(oCreated.ID, oBody.ProjectTask).then(function () {
					return ok({ ProjectKey: oCreated.ID });
				});
			});
		}
	};

	function assignmentPath(sEmpId, sProjectId, sBillingId) {
		return "UserToProject(Employee_EmployeeID=" + Hrx.literal(sEmpId) + ",Project_ID=" + sProjectId +
			",BillingID_ID=" + sBillingId + ")";
	}

	function toTimestamp(sDate) {
		return sDate ? String(sDate).slice(0, 10) + "T00:00:00Z" : null;
	}

	/**
	 * Applies one change to every assignment row of a person on a project (there is one
	 * row per billing scheme).
	 * @param {string} sEmpId the employee ID
	 * @param {string} sProjectId the project ID
	 * @param {object} oChange the fields to set
	 * @returns {Promise<object>} the xsjs-style success answer
	 */
	function setAssignmentActive(sEmpId, sProjectId, oChange) {
		return Hrx.list("UserToProject", {
			$filter: "Employee_EmployeeID eq " + Hrx.literal(sEmpId) + " and Project_ID eq " + sProjectId
		}).then(function (aRows) {
			return Promise.all(aRows.map(function (oRow) {
				return Hrx.update(assignmentPath(oRow.Employee_EmployeeID, oRow.Project_ID, oRow.BillingID_ID), oChange);
			}));
		}).then(function () {
			return ok({});
		});
	}

	var Assignments = {

		fetch: function (oParams) {
			return Promise.all([
				Hrx.list("UserToProject", {
					$filter: "Project_ID eq " + oParams.projectKey,
					$expand: "Employee($select=EmployeeID,FirstName,LastName,WorkEmail,ImageRootID,ImageObjectID)"
				}),
				HrxLegacyProjects.Areas.resourceAreasOf(oParams.projectKey)
			]).then(function (aResults) {
				var aRows = aResults[0];
				var mAreasByEmployee = aResults[1];
				return ok({
					assignments: aRows.map(function (oRow) {
						var oEmployee = oRow.Employee || {};
						return {
							ASSIGNMENTID: [oRow.Employee_EmployeeID, oRow.Project_ID, oRow.BillingID_ID].join("|"),
							OrgID: "",
							ProjectKey: oRow.Project_ID,
							EmpID: oRow.Employee_EmployeeID,
							FName: oEmployee.FirstName || "",
							LName: oEmployee.LastName || "",
							// the resourcing table's avatar reads these spellings
							Fname: oEmployee.FirstName || "",
							Lname: oEmployee.LastName || "",
							Email: lower(oEmployee.WorkEmail),
							Pic: pictureOf(oRow.Employee),
							BillingID: oRow.BillingID_ID,
							DayRate: oRow.DayRate || "0",
							DayCost: oRow.DayCost || "",
							BillableDays: oRow.BillableDays || "0",
							TotalCharge: oRow.TotalCharge || "",
							StartDate: oRow.StartDate ? String(oRow.StartDate).slice(0, 10) : null,
							AssignmentStartDate: oRow.StartDate ? String(oRow.StartDate).slice(0, 10) : null,
							IsActive: yn(oRow.IsActive !== false),
							TaskAssigned: mAreasByEmployee[oRow.Employee_EmployeeID] || []
						};
					})
				});
			});
		},

		"new": function (oBody) {
			var oAssignment = {
				Employee_EmployeeID: oBody.EmpID,
				Project_ID: oBody.ProjectID,
				BillingID_ID: oBody.BillingID,
				DayRate: String(oBody.DayRate || "0"),
				Currency: oBody.Currency || "GBP",
				BillableDays: String(oBody.BillableDays || "0"),
				TotalCharge: String(oBody.TotalCharge || ""),
				StartDate: toTimestamp(oBody.StartDate),
				IsActive: true
			};
			if (HrxServices.hasProperty("UserToProject", "DayCost")) {
				oAssignment.DayCost = String(oBody.DayCost || "");
			}
			return Hrx.create("UserToProject", oAssignment).then(function () {
				return HrxLegacyProjects.Areas.saveResourceAreas(oBody.ProjectID, oBody.EmpID, oBody.TaskAssigned);
			}).then(function () {
				return ok({});
			});
		},

		/** The billing scheme is part of the key, so a change of scheme is a new row. */
		edit: function (oBody) {
			var aKey = String(oBody.AssignmentID || "").split("|");
			var oChange = {
				DayRate: String(oBody.DayRate || "0"),
				BillableDays: String(oBody.BillableDays || "0"),
				TotalCharge: String(oBody.TotalCharge || ""),
				StartDate: toTimestamp(oBody.StartDate),
				IsActive: isYes(oBody.IsActive)
			};
			if (HrxServices.hasProperty("UserToProject", "DayCost")) {
				oChange.DayCost = String(oBody.DayCost || "");
			}
			if (aKey.length === 3 && aKey[2] !== oBody.BillingID) {
				return Hrx.remove(assignmentPath(aKey[0], aKey[1], aKey[2])).then(function () {
					return Assignments["new"](Object.assign({}, oBody, { EmpID: aKey[0], ProjectID: aKey[1] }));
				});
			}
			var sEmpId = aKey[0] || oBody.EmpID;
			var sProjectId = aKey[1] || oBody.ProjectID;
			return Hrx.update(assignmentPath(sEmpId, sProjectId, aKey[2] || oBody.BillingID), oChange)
				.then(function () {
					return HrxLegacyProjects.Areas.saveResourceAreas(sProjectId, sEmpId, oBody.TaskAssigned);
				})
				.then(function () {
					return ok({});
				});
		},

		release: function (oBody) {
			return setAssignmentActive(oBody.empID, oBody.projectID, {
				IsActive: false,
				EndDate: new Date().toISOString()
			});
		},

		/** Puts a released resource back on the project. */
		reassign: function (oBody) {
			return setAssignmentActive(oBody.empID, oBody.projectID, {
				IsActive: true,
				EndDate: null
			});
		}
	};

	/* ----------------------------------------------------------------- */
	/* routing                                                           */
	/* ----------------------------------------------------------------- */

	/**
	 * How an entity set is read from /hrx: the sets above, then the client and project
	 * sets of HrxLegacyClients / HrxLegacyProjects (once the HRX service has them).
	 * @param {string} sSet e.g. "Resources" or "LicensedAppsData"
	 * @returns {function|null} read(mParameters) -> Promise<Array<object>>, or null
	 */
	function entitySetReader(sSet) {
		if (ENTITY_SETS[sSet]) {
			return function () {
				return ENTITY_SETS[sSet]();
			};
		}
		return HrxLegacyClients.entitySet(sSet) || HrxLegacyProjects.entitySet(sSet);
	}

	// Service path (after /services/) -> the commands answered here.
	var SERVICES = {
		"timesheet/timesheet.xsjs": Timesheet,
		"hrx/leaveReqs.xsjs": {
			fetchUser: Leave.fetchUser, getDates: Leave.getDates, requestLeave: Leave.requestLeave,
			update: Leave.update, "delete": Leave["delete"]
		},
		"hrx/leaveApprovals.xsjs": { pendingApproval: Leave.pendingApproval, action: Leave.action },
		"hrx/teamCalendar1.xsjs": { team: Leave.team },
		"master/manageUsers.xsjs": Users,
		"hrx/manageClients.xsjs": Clients,
		"hrx/manageProjects.xsjs": Projects,
		"hrx/manageAssignments.xsjs": Assignments
	};

	return {

		LEAVE_STATUS_IDS: LEAVE_STATUS_IDS,

		/**
		 * @param {string} sFrom the first day, "yyyy-MM-dd"
		 * @param {string} sTo the last day, "yyyy-MM-dd"
		 * @returns {Promise<Array<object>>} the missingTimesheet report rows
		 */
		missingTimesheet: function (sFrom, sTo) {
			return Timesheet.missingTimesheet({ fromDate: sFrom, toDate: sTo });
		},

		leaveStatus: leaveStatus,

		/**
		 * @returns {Promise<Array<object>>} the leave types: ID (the service's key),
		 * code (HOLIL, SICKL, ...) and desc
		 */
		leaveTypes: function () {
			return Data.leaveTypes();
		},

		/**
		 * Answers an xsjs call from /hrx, when it is one answered here.
		 * @param {string} sUrl the call's url
		 * @param {object} [oInit] its fetch options
		 * @returns {Promise<object>|null} the answer, or null to let the call through
		 */
		handle: function (sUrl, oInit) {
			var oUrl = new URL(sUrl, document.baseURI);
			var aMatch = /\/services\/(.+\.xsjs)$/.exec(oUrl.pathname);
			var oService = aMatch && (SERVICES[aMatch[1]] || HrxLegacyClients.service(aMatch[1]) || HrxLegacyProjects.service(aMatch[1]));
			var sCmd = oUrl.searchParams.get("cmd");
			var fnCommand = oService && sCmd && Object.prototype.hasOwnProperty.call(oService, sCmd) && oService[sCmd];

			if (typeof fnCommand !== "function") {
				return null;
			}

			var oArgs = {};
			oUrl.searchParams.forEach(function (sValue, sKey) {
				oArgs[sKey] = sValue;
			});
			if (oInit && oInit.body) {
				try {
					oArgs = Object.assign(oArgs, JSON.parse(oInit.body));
				} catch (oError) {
					// not JSON - the query string is all there is
				}
			}
			return Promise.resolve().then(function () {
				return fnCommand.call(oService, oArgs);
			});
		},

		/**
		 * @param {string} sPath an entity set path, e.g. "/Task"
		 * @returns {boolean} true when reads of that entity set are answered from /hrx
		 */
		answers: function (sPath) {
			var aMatch = /^\/?([A-Za-z_]+)/.exec(String(sPath));
			return !!(aMatch && entitySetReader(aMatch[1]));
		},

		/**
		 * Answers an OData V2 read from /hrx, when the entity set is one answered here.
		 * @param {string} sPath e.g. "/Resources" or "/Resources('S000000010')"
		 * @param {object} [mParameters] filters, urlParameters
		 * @returns {Promise<object>|null} { results } or the single entity, or null
		 */
		read: function (sPath, mParameters) {
			var aMatch = /^\/?([A-Za-z_]+)(?:\((.*)\))?$/.exec(String(sPath));
			var sSet = aMatch && aMatch[1];
			var fnReadSet = sSet && entitySetReader(sSet);
			if (!fnReadSet) {
				return null;
			}

			return fnReadSet(mParameters).then(function (aRows) {
				if (aMatch[2] !== undefined) {
					var sKeyName = ENTITY_KEYS[sSet];
					var oKey = new RegExp("(?:^|,)" + sKeyName + "='([^']*)'").exec(aMatch[2]) || /^'([^']*)'$/.exec(aMatch[2]);
					var sKey = oKey ? decodeURIComponent(oKey[1]) : "";
					var oRow = aRows.filter(function (o) {
						return String(o[sKeyName]) === sKey;
					})[0];
					if (!oRow) {
						throw new Error("Not found: " + sPath);
					}
					return oRow;
				}

				var aFilters = (mParameters && mParameters.filters) || [];
				return {
					results: aRows.filter(function (oRow) {
						return aFilters.every(function (oFilter) {
							return matches(oRow, oFilter);
						});
					})
				};
			});
		}
	};
});
