#!/bin/sh
# Runs a copy of the HRX service on http://localhost:4004 with an in-memory database,
# mock users and the fake Document Management server - never the real credentials.
set -e
HRX_SERVICE_DIR=/Users/davidakilapa/Documents/GitHub/HRXService
TEST_DIR=$(dirname "$0")
COPY_DIR="$TEST_DIR/service-copy"
rm -rf "$COPY_DIR" && mkdir -p "$COPY_DIR"
rsync -a --exclude .git --exclude node_modules --exclude .env --exclude 'db/.env' --exclude gen "$HRX_SERVICE_DIR/" "$COPY_DIR/"
ln -s "$HRX_SERVICE_DIR/node_modules" "$COPY_DIR/node_modules"
# Local test only: HANA hands back the upper-case column name EMPID_EMPLOYEEID, the
# in-memory SQLite database the mixed-case EmpID_EmployeeID. Accept either here.
sed -i '' 's/RequesterID\[0\]\.EMPID_EMPLOYEEID/(RequesterID[0].EMPID_EMPLOYEEID || RequesterID[0].EmpID_EmployeeID)/' "$COPY_DIR/srv/hrx-services.js"
# Local test only: no real email, ever. A stand-in "nodemailer" goes in the copy's
# srv/node_modules, which Node searches before the real package for every file under
# srv/, so every send is only logged. The service does not start unless that holds.
mkdir -p "$COPY_DIR/srv/node_modules/nodemailer"
cp "$TEST_DIR/no-mail.js" "$COPY_DIR/srv/node_modules/nodemailer/index.js"
for MAIL_USER in "$COPY_DIR/srv" "$COPY_DIR/srv/lib" "$COPY_DIR/srv/handlers"; do
	RESOLVED=$(cd "$MAIL_USER" && node -e 'console.log(require.resolve("nodemailer"))')
	case "$RESOLVED" in
		"$COPY_DIR/srv/node_modules/nodemailer/index.js"|*"/service-copy/srv/node_modules/nodemailer/index.js") ;;
		*) echo "REFUSING TO START: nodemailer resolves to $RESOLVED from $MAIL_USER" >&2; exit 1 ;;
	esac
done
export VCAP_SERVICES='{"sdm":[{"name":"dms","credentials":{"uaa":{"url":"http://localhost:4005","clientid":"test","clientsecret":"test"},"endpoints":{"ecmservice":{"url":"http://localhost:4005/"}}}}]}'
export CDS_CONFIG='{"requires":{"auth":{"kind":"mocked","users":{"sam.evans@example.test":{"password":"","ID":"sam.evans@example.test"},"dan.barton@example.test":{"password":"","ID":"dan.barton@example.test"},"kyle.barnfield@example.test":{"password":"","ID":"kyle.barnfield@example.test"}}}}}'
export HRX_MAIL_DRY_RUN=true
cd "$COPY_DIR" && exec npx cds serve all --in-memory --port 4004
