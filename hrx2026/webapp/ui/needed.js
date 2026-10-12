/*
 * The services the HRX CAP service still needs before the whole design can run on real
 * data. Pages show the matching block where the feature would be (there is no sample
 * data in its place), and App Explorer → HRX services lists them all.
 *
 * Each entry: title, where it shows, what the app does today, and the endpoints needed
 * (proposed names, in the style of the existing service).
 */
sap.ui.define(["./core"], function (hrx) {
	"use strict";

	var E = "Entity", F = "Function", A = "Action", P = "Field";
	var N = {
		policies: {
			title: "Policies & acknowledgements",
			where: "Policies to read; Documents; Home — Docs awaiting acknowledgement",
			now: "Not shown.",
			needs: [
				[E, "Policies", "Name, category, version, published on, audience (all employees or a site), acknowledgement required, file (SAP Document Management object ID)"],
				[E, "PolicyAcknowledgements", "Policy, employee, acknowledged at"],
				[F, "fetchMyPolicies()", "The policies the signed-in user should read, and whether they have acknowledged each"],
				[A, "acknowledgePolicy(PolicyID)", "Records the signed-in user's acknowledgement"],
				[F, "fetchPolicyAcknowledgements(PolicyID)", "Who has and hasn't acknowledged a policy (managers)"],
				[E, "Documents — object type Policy", "Upload the policy file the way pictures and logos are uploaded today"]
			]
		},
		reminders: {
			title: "Reminders & notifications",
			where: "Timesheet reporting — Remind; Sickness — check in; Documents — Remind outstanding; the bell",
			now: "Reminders open your mail app; the bell is worked out from live data.",
			needs: [
				[A, "sendReminder(Type, EmployeeIDs, Message)", "Sends the reminder email from the service"],
				[E, "Notifications", "Optional: a stored notification list for the bell, with read state per user"]
			]
		},
		sickness: {
			title: "Sickness follow-up",
			where: "Sickness — trigger outcomes, return-to-work checklist",
			now: "Absences and triggers are real; outcomes and checklist progress are kept in this browser only.",
			needs: [
				[E, "SicknessReviews", "Employee, trigger, outcome (open / messaged / dismissed), note, reviewed by, reviewed at"],
				[E, "ReturnToWork", "Employee, absence (LeaveGrpID), step, done at, done by"]
			]
		},
		clientTeam: {
			title: "Client support team",
			where: "Manage Clients — Support Team; Manage Projects — Client Team",
			now: "Not shown.",
			needs: [[E, "ClientUsers", "Client, first and last name, email, mobile, active, admin"]]
		},
		clientSla: {
			title: "Client service levels",
			where: "Manage Clients — SLA",
			now: "Not shown.",
			needs: [[E, "ClientSLAs", "Client, severity, response time (hours), resolution time (hours)"]]
		},
		clientComponents: {
			title: "Licensed components",
			where: "Manage Clients — Components",
			now: "Not shown.",
			needs: [[E, "ClientComponents", "Client, software, component, sub-component, valid from / till, supported, system, install date, version, object and support costs, cloud"]]
		},
		clientApps: {
			title: "Application services",
			where: "Manage Clients — Application Details",
			now: "Not shown.",
			needs: [[E, "ClientApplications", "Client, app, service, valid from / till"]]
		},
		projectAreas: {
			title: "Project areas",
			where: "Manage Projects — Project Info",
			now: "Not shown.",
			needs: [[E, "ProjectAreas", "Project, area (Basis, Development, Functional, Integration, Testing, UX Design) — or a field on Projects"]]
		},
		projectTeam: {
			title: "Project client team",
			where: "Manage Projects — Client Team",
			now: "Not shown.",
			needs: [[E, "ProjectClientTeam", "Project, client user (needs ClientUsers)"]]
		},
		projectAttachments: {
			title: "Project attachments",
			where: "Manage Projects — Attachments",
			now: "Not shown.",
			needs: [
				[E, "Documents — object type Project", "Upload a file against a project"],
				[F, "fetchProjectDocuments(ProjectID)", "List a project's files (name, size, uploaded by, uploaded at)"]
			]
		},
		jobTitle: {
			title: "Job title",
			where: "Team Calendar subtitle; Manage Resources",
			now: "The user type (Staff / Contractor) is shown instead.",
			needs: [[P, "Users.JobTitle", ""]]
		},
		contactName: {
			title: "Client contact name",
			where: "Manage Clients — primary contact",
			now: "Email and phone are shown; the name field is disabled.",
			needs: [[P, "Contacts.FirstName, Contacts.LastName", ""]]
		},
		bonusObjectives: {
			title: "Bonus objectives & annual feedback",
			where: "My Bonus",
			now: "Only the bonus paid each month is shown.",
			needs: [[E, "BonusObjectives", "Employee, year, objective, weighting, achieved, annual feedback"]]
		},
		dayCost: {
			title: "Day cost",
			where: "Manage Projects — Assign resource",
			now: "Only the day rate is held.",
			needs: [[P, "UserToProject.DayCost", ""]]
		},
		expenses: {
			title: "Expenses",
			where: "Side rail (coming soon)",
			now: "Out of scope for HRX — planned as its own app.",
			needs: []
		}
	};

	var needed = {
		ALL: N,
		/** the endpoints an entry needs, as a list */
		list: function (k) {
			return "<ul class=\"need-list\">" + N[k].needs.map(function (n) {
				return "<li><span class=\"need-kind\">" + n[0] + "</span><code>" + hrx.esc(n[1]) + "</code>" + (n[2] ? "<span class=\"need-d\">" + hrx.esc(n[2]) + "</span>" : "") + "</li>";
			}).join("") + "</ul>";
		},
		/** a card in place of a feature the service cannot back yet */
		block: function (k, sIntro) {
			var n = N[k];
			return "<div class=\"need\"><div class=\"need-head\"><span class=\"need-ico\"><i class=\"ti ti-plug-connected-x\"></i></span><div><div class=\"need-t\">Service needed — " + hrx.esc(n.title) + "</div>" +
				"<div class=\"need-s\">" + hrx.esc(sIntro || "The HRX service has no endpoint for this yet, so there is nothing to show. It needs:") + "</div></div></div>" + needed.list(k) +
				"<div class=\"need-foot\">All missing services are listed in <button class=\"alert-link\" type=\"button\" data-go=\"services\">App Explorer → HRX services" + hrx.ICON.arrow + "</button></div></div>";
		},
		/** a one-line note on a page that works, but keeps part of its data outside the service */
		strip: function (k, sText) {
			var n = N[k];
			return "<div class=\"strip warn\">" + hrx.ICON.tri + "<span>" + hrx.esc(sText || n.now) + " <b>Service needed:</b> " + n.needs.map(function (x) { return "<code>" + hrx.esc(x[1]) + "</code>"; }).join(", ") + ".</span></div>";
		}
	};
	return needed;
});
