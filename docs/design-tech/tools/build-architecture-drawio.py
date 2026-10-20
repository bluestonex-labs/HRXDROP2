"""Builds docs/design-tech/hrx-architecture.drawio: the HRX architecture as a draw.io diagram.

Run from the repository root:  python3 docs/design-tech/tools/build-architecture-drawio.py
The logos are embedded from docs/branding, so the .drawio file opens anywhere on its own.
Labels use Raleway; draw.io loads it from Google Fonts (fontSource in each style).
Then render the PNG with tools/render-drawio.js.
"""
import base64
import html
import os
import urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "docs", "design-tech", "hrx-architecture.drawio")

FONT = "fontFamily=Raleway;fontSource=" + urllib.parse.quote("https://fonts.googleapis.com/css?family=Raleway", safe="") + ";"

# The app's colour tokens (hrx2026/webapp/css/style.css) and the HRX logo's gradient
INK = "#33343A"
TXT2 = "#6D6E72"
ICE = "#26AAE2"
ICE_DEEP = "#1888BC"
VIOLET = "#756EE5"
MAGENTA = "#9B39B0"
MINT = "#1FAE72"
AMBER = "#D97706"
AMBER_SOFT = "#FEF3C7"
FROST = "#F3F5F7"
LINE = "#E3E6EA"

cells = []
next_id = [2]


def new_id():
    next_id[0] += 1
    return "c" + str(next_id[0])


def label(title, *lines):
    """A bold first line, then smaller lines underneath (html label)."""
    sub = "".join("<br><span style=\"font-size:10px;color:" + TXT2 + "\">" + html.escape(line) + "</span>" for line in lines)
    return "<b>" + html.escape(title) + "</b>" + sub


def box(x, y, w, h, value, fill="#FFFFFF", stroke=ICE, parent="1", extra=""):
    cell_id = new_id()
    style = ("rounded=1;arcSize=10;whiteSpace=wrap;html=1;fillColor=" + fill + ";strokeColor=" + stroke +
             ";strokeWidth=1.5;fontColor=" + INK + ";fontSize=12;align=center;verticalAlign=middle;spacing=6;" + FONT + extra)
    cells.append('<mxCell id="%s" value="%s" style="%s" vertex="1" parent="%s"><mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
                 % (cell_id, html.escape(value, quote=True), style, parent, x, y, w, h))
    return cell_id


def group(x, y, w, h, title, stroke, fill, dashed=False):
    cell_id = new_id()
    style = ("rounded=1;arcSize=3;whiteSpace=wrap;html=1;fillColor=" + fill + ";strokeColor=" + stroke + ";strokeWidth=1.5;" +
             ("dashed=1;dashPattern=6 4;" if dashed else "") +
             "verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;fontStyle=1;fontSize=13;fontColor=" + stroke + ";container=0;" + FONT)
    cells.append('<mxCell id="%s" value="%s" style="%s" vertex="1" parent="1"><mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
                 % (cell_id, html.escape(title, quote=True), style, x, y, w, h))
    return cell_id


def text(x, y, w, h, value, size=12, color=INK, bold=False, align="left"):
    cell_id = new_id()
    style = ("text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;align=" + align + ";verticalAlign=middle;fontSize=" + str(size) +
             ";fontColor=" + color + ";" + ("fontStyle=1;" if bold else "") + FONT)
    cells.append('<mxCell id="%s" value="%s" style="%s" vertex="1" parent="1"><mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
                 % (cell_id, html.escape(value, quote=True), style, x, y, w, h))
    return cell_id


def image(x, y, w, h, path):
    with open(os.path.join(ROOT, path), "rb") as file:
        data = base64.b64encode(file.read()).decode("ascii")
    cell_id = new_id()
    # draw.io's own form for an embedded image: "data:image/png," then the base64 data
    style = "shape=image;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=1;aspect=fixed;image=data:image/png," + data + ";"
    cells.append('<mxCell id="%s" value="" style="%s" vertex="1" parent="1"><mxGeometry x="%d" y="%d" width="%d" height="%d" as="geometry"/></mxCell>'
                 % (cell_id, style, x, y, w, h))
    return cell_id


def arrow(source, target, value, color=INK, dashed=False, exit=None, entry=None, points=None, label_pos=None):
    cell_id = new_id()
    style = ("edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=blockThin;endFill=1;strokeWidth=1.6;strokeColor=" + color +
             ";fontColor=" + INK + ";fontSize=10;labelBackgroundColor=#FFFFFF;" + ("dashed=1;dashPattern=6 4;" if dashed else "") + FONT)
    if exit:
        style += "exitX=%s;exitY=%s;exitDx=0;exitDy=0;" % exit
    if entry:
        style += "entryX=%s;entryY=%s;entryDx=0;entryDy=0;" % entry
    geometry = '<mxGeometry relative="1" as="geometry">'
    if label_pos is not None:
        geometry = '<mxGeometry x="%s" relative="1" as="geometry">' % label_pos
    if points:
        geometry += "<Array as=\"points\">" + "".join('<mxPoint x="%d" y="%d"/>' % p for p in points) + "</Array>"
    geometry += "</mxGeometry>"
    cells.append('<mxCell id="%s" value="%s" style="%s" edge="1" parent="1" source="%s" target="%s">%s</mxCell>'
                 % (cell_id, html.escape(value, quote=True), style, source, target, geometry))
    return cell_id


# ── Header ──
image(30, 18, 113, 64, "docs/branding/hrx-logo.png")
text(160, 22, 700, 30, "HRX — Architecture", size=22, bold=True)
text(160, 52, 900, 22, "How a request travels from the browser to the HRX service, and what sits behind it", size=12, color=TXT2)
image(1474, 22, 206, 64, "docs/branding/bluestonex-logo.png")

# ── People and the app in their browser ──
group(30, 120, 250, 740, "People", TXT2, "#FFFFFF", dashed=True)
browser = box(45, 185, 220, 80, label("Web browser", "Manager · Employee", "Admin (full access)"), stroke=INK)
ui5app = box(45, 320, 220, 190, label("HRX app · SAPUI5 1.150", "bsx.hrx.hrx2026, in the browser",
                                      "XML views, controllers, fragments", "OData V4 client for /hrx",
                                      "older xsjs-style calls answered", "in the browser by model/HrxLegacy*.js"), fill="#F2FAFE")

# ── SAP BTP ──
btp = group(300, 120, 1170, 740, "SAP BTP · Cloud Foundry · org bsx-tdd · space TDD (eu10)", ICE_DEEP, "#F8FBFD")

group(320, 160, 470, 280, "HRX2026 MTA · the app (repo HRXDROP2)", ICE, "#FFFFFF")
launchpad = box(340, 205, 210, 195, label("SAP BTP launchpad", "managed app router", "routes in xs-app.json",
                                          "sap.cloud.service hrx2026"))
html5 = box(560, 205, 210, 90, label("HTML5 Application Repository", "HRX2026-html5-app-host-service", "app-host · bsxhrxhrx2026.zip"))
uaa_app = box(560, 310, 210, 90, label("XSUAA", "HRX2026-xsuaa-service", "xsappname hrx2026"))

group(320, 465, 470, 375, "Destinations", ICE, "#FFFFFF")
destsvc = box(340, 505, 430, 55, label("Destination service", "HRX2026-destination-service · lite"))
dest_ui5 = box(340, 580, 210, 80, label("ui5", "/resources/* → ui5.sap.com", "the SAPUI5 runtime"), fill=FROST, stroke=LINE)
dest_hrx = box(560, 580, 210, 80, label("hrxservice", "/hrx/* · OAuth2UserTokenExchange", "token from bsx-hrx-xsuaa"))
dest_old = box(340, 675, 210, 80, label("bsxorgappsservices", "/services/* · old OData service:", "only its $metadata still loads"), fill=FROST, stroke=LINE)
dest_dms = box(560, 675, 210, 80, label("dms_service", "/browser/* · pictures and logos", "subaccount destination"))
dest_bas = box(340, 770, 430, 55, label("hrxservices / dms_service in Business Application Studio",
                                        "ui5.yaml: the BAS preview reaches the same service"), fill=FROST, stroke=LINE)

group(830, 160, 620, 420, "bsx-hrx MTA · the service (repo HRXService, branch dev)", VIOLET, "#FFFFFF")
cap = box(850, 205, 290, 110, label("CAP service bsx-hrx-srv", "Node.js 22 · @sap/cds 6", "OData V4 at /hrx · authenticated users only",
                                    "srv/hrx-services.cds · hrx-services.js · handlers/*"), stroke=VIOLET)
uaa_srv = box(1160, 205, 270, 80, label("XSUAA bsx-hrx-xsuaa", "xsappname HRXService", "key bsx-hrx-xsuaa-key"), stroke=VIOLET)
hana = box(1160, 320, 270, 110, label("SAP HANA Cloud", "HDI container bsx-hrx-db", "hdi-shared · tables from db/hrx.cds",
                                      "no calculation views"), stroke=VIOLET, extra="shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;")
deployer = box(1160, 465, 270, 60, label("bsx-hrx-db-deployer (hdb)", "deploys db/*.cds to the container"), stroke=VIOLET)
mailbox = box(850, 400, 290, 90, label("Email (nodemailer)", "srv/lib/mail.js: login from HRX_MAIL_*",
                                       "older leave mails: login written in the code"), stroke=VIOLET)

group(830, 600, 620, 240, "SAP Document Management", MAGENTA, "#FFFFFF")
dms = box(850, 640, 330, 115, label("Document Management (CMIS)", "instance sapProcessAutomationDms",
                                    "key spa_dms_servicekey → HRX_DMS_CREDENTIALS", "repository 0dc65852-…"), stroke=MAGENTA)
box(1200, 640, 230, 115, label("Shared with SAP Process Automation", "the service has no binding of its own:",
                               "it uses that instance's existing key"), fill=AMBER_SOFT, stroke=AMBER)
box(850, 775, 580, 45, label("Folders /HRX/Users · Clients · Sites · Organisations · Policies · Projects"), fill=FROST, stroke=LINE)

# ── Outside BTP ──
group(1495, 120, 185, 300, "Outside BTP", AMBER, "#FFFFFF", dashed=True)
o365 = box(1510, 300, 155, 90, label("Microsoft 365", "smtp.office365.com", "port 587"), stroke=AMBER)

# ── Development ──
group(30, 890, 1440, 150, "Development and delivery", MINT, "#FFFFFF")
bas = box(55, 935, 300, 80, label("SAP Business Application Studio", "npm run start-bas · cds watch", "a local copy of the service on :4004"), stroke=MINT)
github = box(420, 935, 380, 80, label("GitHub", "davida012/HRXDROP2 (app) · bluestonex-labs/HRX2026",
                                      "bluestonex-labs/HRXService (service, branch dev)"), stroke=MINT)
build = box(865, 935, 360, 80, label("Build and deploy", "mbt build → mta_archives/*.mtar",
                                     "cf deploy … --retries 1 (by Bala), both MTAs"), stroke=MINT)

# ── Legend ──
group(1495, 440, 185, 600, "Legend", TXT2, "#FFFFFF")
legend = [
    (ICE, False, "Request at run time"),
    (VIOLET, False, "Service to its backing services"),
    (MAGENTA, False, "Files (CMIS)"),
    (AMBER, False, "Email"),
    (MINT, True, "Build and deploy"),
]
for index, (color, dashed, name) in enumerate(legend):
    y = 485 + index * 42
    start = box(1510, y, 6, 6, "", fill=color, stroke=color)
    end = box(1560, y, 6, 6, "", fill=color, stroke=color)
    arrow(start, end, "", color=color, dashed=dashed)
    text(1572, y - 12, 105, 30, name, size=10)
for index, (fill, stroke, name) in enumerate([("#FFFFFF", ICE, "HRX2026 MTA (app)"), ("#FFFFFF", VIOLET, "bsx-hrx MTA (service)"),
                                              ("#FFFFFF", MAGENTA, "SAP Document Management"), (AMBER_SOFT, AMBER, "Known risk"),
                                              (FROST, LINE, "Supporting route")]):
    y = 705 + index * 36
    box(1510, y, 36, 22, "", fill=fill, stroke=stroke)
    text(1552, y - 4, 125, 30, name, size=10)
text(1510, 890, 165, 140, "Numbers follow one request: sign in, load the app, call /hrx through the app router, "
     "on to the service with an exchanged token.", size=10, color=TXT2)

# ── Arrows ──
arrow(browser, launchpad, "1 · HTTPS, sign-in", color=ICE, exit=("1", "0.5"), entry=("0", "0.18"))
arrow(launchpad, html5, "2 · app files", color=ICE, exit=("1", "0.23"), entry=("0", "0.5"))
arrow(launchpad, uaa_app, "user token", color=ICE, exit=("1", "0.77"), entry=("0", "0.5"))
arrow(browser, ui5app, "runs", color=ICE)
arrow(ui5app, launchpad, "3 · /hrx/* · /browser/*", color=ICE, exit=("1", "0.4"), entry=("0", "0.75"))
arrow(launchpad, destsvc, "looks up the destination", color=ICE, exit=("0.5", "1"), entry=("0.245", "0"))
arrow(dest_hrx, cap, "4 · OData V4, token exchanged", color=ICE, exit=("1", "0.5"), entry=("0", "0.5"), points=[(810, 620), (810, 260)], label_pos="0.35")
arrow(dest_dms, dms, "CMIS read", color=MAGENTA, exit=("1", "0.5"), entry=("0", "0.6"))
arrow(cap, uaa_srv, "validates the JWT", color=VIOLET, exit=("1", "0.3"), entry=("0", "0.5"))
arrow(cap, hana, "CDS / SQL", color=VIOLET, exit=("1", "0.8"), entry=("0", "0.3"))
arrow(deployer, hana, "HDI deploy", color=MINT, dashed=True, exit=("0.5", "0"), entry=("0.5", "1"))
arrow(cap, mailbox, "leave mails, reminders", color=AMBER, exit=("0.5", "1"), entry=("0.5", "0"))
arrow(mailbox, o365, "SMTP 587", color=AMBER, exit=("0.5", "1"), entry=("0.5", "1"), points=[(995, 555), (1480, 555), (1480, 410), (1587, 410)])
arrow(cap, dms, "uploads, file lists", color=MAGENTA, exit=("0", "0.85"), entry=("0", "0.2"), points=[(822, 298), (822, 663)], label_pos="0.55")
arrow(bas, github, "git push / pull", color=MINT, dashed=True)
arrow(github, build, "build from the branch", color=MINT, dashed=True)
arrow(build, btp, "", color=MINT, dashed=True, exit=("0.5", "0"), entry=("0.6368", "1"))
text(1060, 862, 260, 22, "cf deploy → SAP BTP (both MTAs)", size=10, color=MINT, bold=True)

xml = ('<mxfile host="drawio" type="device"><diagram id="hrx-architecture" name="HRX architecture">'
       '<mxGraphModel dx="1700" dy="1060" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" '
       'pageScale="1" pageWidth="1710" pageHeight="1070" background="#FFFFFF" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
       + "".join(cells) + "</root></mxGraphModel></diagram></mxfile>\n")
with open(OUT, "w", encoding="utf-8") as file:
    file.write(xml)
print("Wrote " + os.path.relpath(OUT, ROOT))
