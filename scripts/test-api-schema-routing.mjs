import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("api/_db.ts", "utf8");

assert.match(source, /routeEc10OperationalSql/);
assert.match(source, /whatsapp_bot\.\$1/);
assert.match(source, /crm_auth_users/);
assert.match(source, /crm_auth_sessions/);
assert.match(source, /clients/);
assert.match(source, /traffic_events/);
assert.doesNotMatch(source, /"profiles"/);
assert.doesNotMatch(source, /"organizations"/);
assert.doesNotMatch(source, /"leads"/);
assert.match(source, /args\[0\] = routeQueryInput\(args\[0\]\)/);
assert.match(source, /routedClients\.has\(client\)/);

console.log(JSON.stringify({ passed: 11, total: 11 }));
