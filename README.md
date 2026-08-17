# Device Monitoring Dashboard

Phase 1 implementation: device inventory (add/edit/remove) for firewalls, switches, servers, applications, and cameras, with active/inactive status monitoring via ping/TCP/HTTP checks. See `implementation-plan.md` and `device-type-config.md` (in the project docs) for the full design rationale.

## Project layout

```
server/   Node.js/Express API + MongoDB + the monitoring scheduler
client/   React (Vite) dashboard
docker-compose.yml   Optional local MongoDB for development
```

## Prerequisites

- Node.js 18+ (built and tested here on Node 22)
- A MongoDB instance reachable from the server — either:
  - `docker compose up -d` (starts MongoDB on `localhost:27017`), or
  - a local MongoDB install, or a hosted instance (Atlas, etc.)
- On Linux, the `ping` system command must be installed for the ICMP check method (`sudo apt install iputils-ping` on Debian/Ubuntu — it's preinstalled on most servers and on macOS/Windows already).

## Backend setup

```bash
cd server
cp .env.example .env      # edit MONGODB_URI if not using the default docker-compose setup, and set a real JWT_SECRET
npm install
npm run seed:admin -- admin your-password-here   # creates the first admin user (needs MongoDB running)
npm run dev                # starts on http://localhost:4000
```

The dashboard requires login — there's no public sign-up page on purpose (this is an internal ops tool). `npm run seed:admin -- <username> <password> [email]` creates the first admin account (or resets an existing one's password/role to admin if the username already exists). From then on, that admin can create more users (admin or operator) from the Users page in the UI. If you forget to seed one, the server logs a reminder on startup when it detects zero users in the database.

Want a working RBAC example instead of an empty dashboard? `npm run seed:demo` creates 3 groups (`headquarters`, `east-datacenter`, `west-datacenter`) with 2 devices each (safe RFC 5737 test addresses, so they "monitor" without ever reaching a real host), plus 5 users covering every group-visibility case — an admin, one operator per group, and an unrestricted operator — all sharing the password `demo-password-123`. Idempotent: safe to re-run, never overwrites existing groups/devices, only resets the seeded users' passwords. Run it before starting the server so the scheduler picks the new devices up immediately (a running server won't notice devices inserted directly into Mongo until it restarts).

Backend tests (no database needed — these test the actual reachability-check logic, the up/down decision logic, and the auth/JWT logic directly):

```bash
npm test                   # ping/tcp/http/snmp/onvif checks + flap-damping + uptime/timeline math + group-access rules + alert gating + auth logic + firewall health engine/fingerprint/credential-encryption
```

There's also `npm run test:integration`, a fuller smoke test that spins up a temporary in-memory MongoDB (via `mongodb-memory-server`) plus a local fake webhook receiver, and exercises the whole CRUD + check-now + history + groups (including rename/delete cascades) + down-alert + audit-log flow through the HTTP API. It needs one-time internet access to download a MongoDB binary the first time it runs (cached afterwards) — this wasn't reachable from the sandbox this project was built in, but should work in a normal dev environment. If it doesn't, run the backend against `docker compose`'s MongoDB instead and exercise the API manually or from the frontend.

## Frontend setup

```bash
cd client
cp .env.example .env       # point VITE_API_BASE_URL at the backend if not the default
npm install
npm run dev                 # starts on http://localhost:5173
```

Open http://localhost:5173 — you'll land on the login page. Sign in with the admin account you seeded above. Once logged in you'll see the dashboard with summary tiles (Total/Up/Down/Unknown) and an empty device table. Use "Add device" to create your first one; the monitor config pre-fills with the type-based defaults from `device-type-config.md` (e.g. servers default to ping, applications default to an HTTP check) and can be overridden per device.

## What's implemented (Phase 1)

- Device CRUD (`/api/devices`) — add, edit, remove, list with type/status/search filters.
- Generic active/inactive monitoring: ping, TCP port check, or HTTP(S) check, configurable per device, with type-based defaults.
- A staggered in-process scheduler (concurrency-capped via `p-limit`) so 100-500 devices don't all get checked at the same instant.
- Flap-damping: a device only flips to "down" after N consecutive failed checks (configurable per device, default 2-3), to avoid false alarms from a single dropped packet.
- Live dashboard updates over Socket.IO — no manual refresh needed when a status changes.
- On-demand "check now" per device.
- **Login + user management**: JWT-based login (`/api/auth/login`), two roles — `admin` (manages devices *and* users) and `operator` (manages devices only). Admins manage other users from the Users page (add, change role, reset password, remove). Passwords are hashed with bcrypt; the REST API and the WebSocket connection both require a valid token. The dashboard itself has no public registration — accounts are created by an admin (or the initial one via `npm run seed:admin`).

## What's implemented (Phase 2)

- **SNMP checks**: a `snmp` monitor method (in addition to ping/tcp/http) for switches/firewalls — defaults to an SNMP GET against `sysUpTime.0` (no device-specific MIB knowledge needed), configurable community string, v1/v2c, port, and OID per device. Requires the `net-snmp` package — run `npm install` in `server/` to pull it in (see note below).
- **Status history + uptime % charts**: every status transition is recorded (`StatusEvent`), and `GET /api/devices/:id/history` reconstructs an up/down/unknown timeline plus 24h/7d/30d uptime % for a device. The dashboard's device table has a "Status history" action opening a timeline + uptime view, with a range selector. History auto-expires after `HISTORY_RETENTION_DAYS` (default 180).
- **Device groups + operator visibility**: devices can be assigned a `group`; operators can be restricted (via the Users page) to only see devices in their assigned group(s) plus any ungrouped device. An operator with no groups assigned is unrestricted, so existing operators aren't locked out by introducing this. Admins always see everything.
- **Audit log**: device and user management actions (create/update/delete, role changes, password resets) are recorded with actor, action, entity, and a diff of what changed. Visible to admins only, under the new "Audit log" nav item (`GET /api/audit`, paginated).

### A note on `net-snmp`

This project's dependencies were installed against the environment it was built in; if `npm install` can't reach your usual registry for `net-snmp` specifically, the app still runs fine — SNMP checks will just fail with a clear "net-snmp package not installed" error until you're able to install it, and ping/tcp/http checks are unaffected.

## UI reskin (AdminLTE)

The frontend was reskinned from MUI to [AdminLTE 4](https://adminlte.io/) (Bootstrap 5), via the official [`@adminlte/react`](https://github.com/ColorlibHQ/adminlte-react) component library:

- **Per-device-type views**: the sidebar has a link per device type (Firewalls, Switches, Servers, Applications, Cameras, Other) plus "All Devices", each its own route (`/devices/:type`) — bookmarkable, and the summary tiles/table scope to whichever is selected.
- `@adminlte/react`'s `Sidebar`/`SidebarNav`/`DashboardLayout` convenience components are Next.js-only (they call `next/navigation` internally); this app hand-assembles the shell from the framework-agnostic pieces (`SidebarBrand`, `SidebarNavItem`, `SidebarOverlay`, `Topbar`) instead. `vite.config.js` aliases `next/navigation` to a small stub (`src/shims/next-navigation.js`) so Vite can still resolve the package's barrel file, which imports every component (including the Next-only ones) unconditionally.
- Modals (`@adminlte/react`'s `<Modal>`) render markup only — visibility is driven by Bootstrap's JS `Modal` instance, not a React prop — see `src/hooks/useBootstrapModal.js` for the imperative show()/hide() wiring used by every dialog.
- Purely a presentation-layer change — all `/api/*` contracts are unchanged, except `GET /api/devices/summary` now also accepts the same `type`/`status`/`group`/`q` filters as the list route (so the tiles match a filtered view like "Cameras only").

## What's implemented (Phase 3)

- **Down alerts**: set `ALERT_WEBHOOK_URL` (a Slack incoming-webhook or Teams Incoming Webhook connector URL) in `server/.env` to get notified when a device goes down, and again on recovery (toggle with `ALERT_ON_RECOVERY`). Alerting is opt-in — leave the URL blank and nothing changes. Per-device mute via the "Send down/recovery alerts for this device" switch in the device form (`alertsEnabled`, default on). The gating logic (`shouldAlert` in `server/src/services/alerts.js`) never alerts on transitions to/from `unknown` or on a device's first-ever successful check — only real down events and recoveries from a confirmed down.
- **ONVIF checks**: an `onvif` monitor method for cameras — an unauthenticated `GetSystemDateAndTime` SOAP call (per the ONVIF spec, available before WS-Security auth, since it's meant for clock sync ahead of it), so no camera credentials are needed for a reachability check. Plain HTTP/SOAP via axios, no ONVIF client library. Configurable port (default 80) and device-service path (default `/onvif/device_service`).
- **Dedicated groups management** (`/groups`, admin-only): a `Group` registry (name + description) with cascading rename (updates every device/user referencing the old name) and cascading delete (unassigns rather than leaving dangling references), both reporting how many devices/users were affected. Existing freeform group strings (from before this page existed) are auto-registered the first time they're listed or assigned, so nothing needed migrating. The device form's Group field and the user form's restricted-groups picker now select from this registry instead of freeform typing, so groups can't drift out of sync via typos — new groups are created on the Groups page.
- Fixed a pre-existing scheduler shutdown race surfaced while testing this: a check already in flight when `scheduler.stop()` ran (e.g. mid network-probe) wasn't actually stopped, and could crash trying to save its result after Mongo disconnects during graceful shutdown. `stop()` now awaits any in-flight checks before returning.

### A note on ONVIF and real cameras

Like SNMP, the ONVIF check path is implemented and unit-tested (including against a fake local SOAP responder) but has never been exercised against a real IP camera — the environment this was built in doesn't have one. Worth a manual smoke test against your actual camera hardware before relying on it.

## What's implemented (Phase 4/5) — generalized connector-based health monitoring (firewall + switch)

A richer, vendor-aware monitoring pipeline, originally built for `type: 'firewall'` devices and then **generalized into a shared layer** (`server/src/monitoring/`) that both firewall and switch connectors reuse — one `ConnectorManager`, one Health Engine state machine, one discovery service, one encrypted-credential store, never a parallel per-type implementation. Kept in plain JavaScript to match the rest of this codebase. It's additive: every existing device using ping/tcp/http/snmp/onvif is completely unaffected — this only activates when a firewall or switch's check method is explicitly set to **"Auto detect vendor"** (`monitor.method: 'connector'`).

### The shared layer (`server/src/monitoring/`)

- **Safe auto-discovery** (`monitoring/discovery/`): ICMP, TCP (443/8443/830/22), an HTTPS TLS-certificate + page-title fingerprint, and a read-only SNMP probe (`sysDescr`/`sysName`/`sysUpTime`) — IP address alone is enough, credentials are entirely optional, and discovery never brute-forces, scans for vulnerabilities, or sends anything destructive. Vendor detection (`vendorFingerprint.js`) reports a confidence score and returns `vendor: null` below 50% rather than guessing. Used unchanged by both firewall and switch — discovery has no device-type-specific logic.
- **Real SNMPv1/v2c/v3 support** (`discovery/snmpSession.js`, `discovery/snmpSecurity.js`) — both discovery's read-only probe and every generic SNMP connector build a proper `net-snmp` session for whichever version the stored credential specifies. For v3, the security level (`noAuthNoPriv`/`authNoPriv`/`authPriv`) is derived automatically from which passwords are present, with SHA/AES as the default auth/priv protocols (MD5/DES also selectable, e.g. for older devices).
- **ConnectorManager** (`monitoring/core/connectorManager.js`) — the only place that decides which source to use and falls back (native API → SNMP → bare TCP/ICMP reachability); vendor connectors never manage their own fallback, and this decision logic is never duplicated per device type. Firewall's and switch's own `connectors/connectorManager.js` are thin wrappers supplying their own native-connector registry, generic SNMP connector, and merge function (the fields each type collects differ — HA/license vs stack/PoE). An API auth failure degrades to the SNMP fallback rather than marking the device offline.
- **Health Engine core** (`monitoring/health/healthEngineCore.js`) — the shared state machine every device type's Health Engine wraps: OFFLINE only when *every* channel (ICMP/HTTPS/API/SNMP/NETCONF) fails, overall = the worst component severity, downgraded to `UNKNOWN` (never fabricated as `HEALTHY`/`CRITICAL`) when there's no real telemetry yet. Component evaluators that are byte-for-byte identical across types (management-channel status, CPU/memory/disk thresholds) live in `monitoring/health/commonEvaluators.js`; type-specific rules (firewall's WAN/HA, switch's uplinks/stack/PoE) are supplied by each type's own health engine.
- **Encrypted credentials**: `PUT /api/devices/:id/credential` stores an AES-256-GCM–encrypted secret (key from `DEVICE_CREDENTIAL_KEY`) in a shared `DeviceCredential` collection — `Device.monitor.credentialId` holds only a reference, and no endpoint ever echoes the secret back. One collection for every connector-monitored device type, not duplicated per type.
- **Backward-compatible status mapping**: the existing scheduler's flap-damping loop still drives the simple Up/Down chip for connector-method devices — only `OFFLINE` maps to "down"; `DEGRADED`/`CRITICAL` are still "up" on that chip (they're reachable, managed devices) with the nuance surfaced in the type-specific Health panel instead.
- **Discovery and polling are separate cadences** — discovery only re-runs if missing/stale (6h) or explicitly forced, never on every ~30-60s poll.
- **Generic routes, shared by every connector-capable type**: `POST /:id/discover`, `PUT`/`DELETE /:id/credential`, `GET /:id/health`, `POST /:id/poll` — `routes/devices.js` dispatches `/poll`'s actual polling service by `device.type` (a short explicit map), and `scheduler.js` does the same for its periodic tick.

### Firewall (`server/src/firewall/`)

- **FortiGate connector** (`firewall/connectors/fortigate/`) — the one vendor implemented this pass, via FortiOS's REST API v2 (system status, resource usage, interfaces, HA checksums, license). Palo Alto/Cisco FTD/Check Point/Juniper are deliberately deferred; the shared `ConnectorManager`/registry pattern is built so they plug in later without touching React. A generic SNMP connector (`genericSnmpConnector.js`) is the always-available fallback for any vendor.
- **Health rules** (`firewall/health/healthEngine.js`): WAN-interface health (a `wan*` name heuristic — narrow and documented, never guessed for other naming conventions), HA peer/sync status, license expiry, on top of the shared management/resources evaluators.
- **UI**: picking "Auto detect vendor" as the check method reveals a "Vendor" dropdown ("Auto-detect (recommended)" / "FortiGate") — an explicit pick is stored as `monitor.vendor` and takes priority over confidence-scored fingerprinting at poll time. Picking FortiGate also reveals its API token field inline, and submitting the form saves the device *and* the credential in one step. Editing a device that already has a credential shows "leave blank to keep current."

### Switch (`server/src/switch/`)

- **Generic SNMP connector** (`switch/connectors/genericSwitchSnmpConnector.js`) — the only connector implemented this pass (no native vendor connector yet; Cisco Catalyst/Aruba/Juniper/Arista/Meraki are all deferred). Reads IF-MIB (`ifTable`: name, admin/oper status, speed, in/out errors and discards) and RFC3621 POWER-ETHERNET-MIB (`pethMainPseTable`: PoE budget/consumption). Stack technology, Layer 2 (STP/LACP), and LLDP topology are **not implemented from standard SNMP** — they need vendor-specific MIBs — so those fields honestly stay `null`/`[]` rather than guessed, exactly like the firewall connector's `getHAStatus()` returning `null`.
- **Port criticality classification** (`switch/core/portClassification.js`) — a normal, unused port going down must never degrade switch health (only a small text-based heuristic recognizes uplink naming conventions like `uplink`/`core`/`dist`/`wan`; everything else defaults to `NORMAL`, mirroring the firewall connector's `wan*` interface-name heuristic in spirit).
- **Health rules** (`switch/health/healthEngine.js`): sole/primary uplink or critical port down → `CRITICAL`; one of several → `DEGRADED`; ordinary ports flapping → no effect on health at all. Stack member loss → `DEGRADED` (or `CRITICAL` if the stack itself reports a critical state). PoE budget ≥80% → `DEGRADED` (per spec, both the 80% and 95% tiers stay `DEGRADED`; `CRITICAL` would require knowing "expected devices can't get power," which generic SNMP can't detect, so it's never fabricated).
- **UI** (`SwitchHealthDialog.jsx`): the same Discover/Poll/Credentials chrome as the firewall dialog (shared via `useDeviceHealthPanel`, `DiscoveryResultCard`, `DeviceCredentialForm`), with switch-specific detail panels — Stack, PoE, Layer 2, and a Ports table showing status/role badge/speed/errors/discards per interface. No vendor dropdown is shown in the Add/Edit form for switches yet (there's nothing to choose between until a native connector exists) — just an info note that SNMP is used for switch health.

### Adaptations from the original spec

- **Plain JavaScript, not TypeScript** — matches the existing codebase; only the architecture/concepts were adopted, per explicit instruction.
- **One `Device` collection, not a set of separate per-type models** — the base entity stays the existing `Device` (so a connector-mode firewall or switch still gets list/CRUD/group/audit/alerts for free); only `DeviceCredential` and `DeviceHealthSnapshot` were added as new collections, shared by every connector-monitored type, with interfaces/alarms/capabilities embedded in the snapshot rather than further split out.
- **Discovery/credentials happen after saving the device**, not before — this app's device form requires a name, unlike the spec's "IP alone" ideal, so discovery needs a saved device id to call `/discover` against. The form still only *requires* IP address + name; credentials stay fully optional, but an explicit vendor pick (firewall only, today) lets you supply that vendor's credential immediately, in the same submit.
- **FortiGate's exact monitor-API endpoint paths (especially HA role/peer detection) and the switch generic connector's PoE/interface OIDs are unverified against live hardware** — no FortiGate or switch hardware in this environment, same caveat as SNMP/ONVIF. Every connector call degrades to `null`/`[]` on an unexpected response shape rather than throwing, so a wrong OID or path fails safely (falls back further down the chain) instead of crashing a poll.
- **The connector's encrypted `DeviceCredential` is intentionally separate from `monitor.snmpCommunity`/`monitor.snmpVersion`** (the plaintext fields used by the plain `'snmp'` check method available to every device type) — they are never auto-shared, even if both are configured for the same device. Mixing an encrypted-secret store with a plaintext monitoring field would blur a security boundary for a convenience that's easy to route around (re-entering a community string once is cheap).
- **`GET /:id/health` reports `hasCredential` independent of whether a poll has ever run** — the endpoint used to return a bare `null` until the first snapshot existed, which meant a credential saved right after device creation looked unset until the scheduler's next tick. It now always reports credential presence from `Device.monitor.credentialId`, even before any snapshot exists.
- **Switch stage scope**: per the switch spec's own phasing, only Stage 4 (generic SNMP connector: interfaces, PoE budget, port classification) and the shared Health Engine wiring were implemented this pass. Native vendor connectors (Stages 7-11: Cisco Catalyst/Nexus, Aruba CX, Juniper EX/QFX, Arista, Meraki), LLDP topology discovery/mapping (Stage 13), and controller-based one-credential-many-devices management sources (e.g. Meraki Dashboard, Catalyst Center) are explicitly deferred — the `ConnectorManager`/registry pattern is built so a native connector plugs in later without touching the shared core or React.

## What's implemented (Phase 6) — SSH login check

A new `ssh` monitor method, available to **every** device type (not gated to firewall/switch like `connector`) — useful for devices managed purely over SSH (switches, servers, appliances) where there's no API/SNMP to fall back on.

- **Real authentication, not just port-open** (`server/src/services/checks.js`'s `sshCheck`, via the `ssh2` package): attempts an actual SSH login with the stored username/password. A wrong password, locked account, or auth failure reports the device as **down** — this is a meaningfully stronger signal than a `tcp` check against port 22, which only proves *something* is listening.
- **Credential handling**: reuses the existing shared `DeviceCredential` encrypted store (the `username_password` type, which existed in the credential schema from the firewall work but had no real consumer until now) — same "leave blank to keep current" UX as the FortiGate API token field, and the same one-step "save device + credential together" flow from the Add/Edit form.
- **Dispatch**: `sshPollingService.js` is a small standalone service (load + decrypt credential, call `sshCheck`) — not folded into `checks.runCheck()` (which has no DB access) and not routed through the full discover → ConnectorManager → Health Engine pipeline (`ssh` is a lightweight credential-confirming check, not a rich normalized-health connector). `scheduler.js` dispatches to it directly, alongside the existing `connector` special-case.
- **Tested against a real local SSH server**: `ssh2` ships both a client *and* a server implementation, so unlike the firewall/switch connectors (whose vendor-specific paths are honestly documented as unverified against live hardware), the SSH check's success path is genuinely exercised in `test-checks.js` and `smoke-test.js` — a real local `ssh2` `Server` accepts a correct password and rejects a wrong one, both asserted end to end.

## What's implemented (Phase 7) — configurable connector port + "last check" transparency

- **Custom management port for the connector pipeline**: `createFortiGateConnector` used to hardcode HTTPS port 443 with no override — a real gap, since FortiGate admin GUIs are commonly moved to a non-default port (e.g. 11443). The Add/Edit form now shows a Port field for the "Auto detect vendor" check method (default 443), threaded through `ConnectorManager.collect()` to the native connector and through `discoveryService.discover()`'s `managementPort` option, so both discovery's HTTPS fingerprinting and the FortiGate connector itself probe/connect on the device's actual configured port instead of silently trying 443. Covered by `test-firewall-connector-port.js`, which spins up a real local HTTPS server (self-signed cert via the system `openssl` CLI) on a non-default port and confirms the connector both succeeds against it and fails when no port override is given.
- **"Last check" panel in the Status History dialog** (`describeCheck.js`): shows exactly what the scheduler is currently running for a device — e.g. `SNMP GET 1.3.6.1.2.1.1.3.0 (v2c, community "public") — 10.0.1.5:161` or `ICMP ping to 10.0.1.5` — plus the current Up/Down/Unknown chip, when it was last checked, and the latency or error from that check. Purely derived from the device's own `monitor` config already in hand (no extra API call), so a user staring at a "why is this down" uptime graph can immediately see *what* is being checked, not just *that* it's down.

## What's implemented (Phase 8) — interface bandwidth for firewall/switch connectors

SNMP has no "current bandwidth" OID — only ever-increasing byte counters. Bandwidth is therefore a *rate*, computed from two consecutive polls' counters over a known time interval, not a single read.

- **64-bit octet counters + accurate link speed** (`genericSnmpConnector.js`, `genericSwitchSnmpConnector.js`): both generic SNMP connectors now also walk IF-MIB's `ifXTable` (`ifHCInOctets`/`ifHCOutOctets` — 64-bit, unlike the 32-bit `ifInOctets`/`ifOutOctets` in `ifTable` that wrap around too fast to be useful on multi-gigabit links; `ifHighSpeed`, which reports Mbps directly and doesn't hit `ifSpeed`'s ~4.3Gbps ceiling) alongside the existing `ifTable` walk, merged by `ifIndex`. `snmpCounters.js`'s `counter64ToNumber()` decodes the `Buffer` net-snmp hands back for `Counter64` varbinds (JS has no native 64-bit integer type).
- **Rate calculation** (`monitoring/core/bandwidthCalculator.js`, shared by both device types): on every poll, the previous `DeviceHealthSnapshot`'s interface counters are fetched and diffed against the current poll's — `Mbps = (currentOctets - previousOctets) * 8 / deltaSeconds / 1,000,000`. Never fabricated: the first-ever poll (nothing to diff against), a counter that went backwards (interface reset/reboot — not a negative/garbage rate), or an interface with no prior counterpart (renamed/new port) all yield `null`. Accuracy is bounded by the poll interval — a 30-60s interval gives a near-real-time average; a longer interval only gives a coarser average over that window, never instantaneous throughput.
- **Per-port and total-device numbers**: each interface gets `rxMbps`/`txMbps`/`utilizationPercent` (relative to that port's own speed); `normalized.bandwidth.totalRxMbps`/`totalTxMbps` sums across every interface with a valid rate. Surfaced in both the Firewall and Switch health dialogs — a "Bandwidth (total, all interfaces/ports)" summary section plus Rx/Tx/Util% columns in the interfaces/ports table.
- **Tested with a full round-trip through the real calculator** (not just live-hardware-dependent): `test-bandwidth-calculator.js` covers the normal-delta case, counter-reset, a brand-new interface with no prior counterpart, and multi-interface totals — all with exact expected Mbps values, not just "doesn't throw."

### Bug found while testing against a real device: concurrent SNMP table walks corrupt data

Adding the `ifXTable` walk above (Phase 8) meant `getInterfaces()` fetched `ifTable` and `ifXTable` via `Promise.all` — two concurrent table walks against the same device. Tested against a real FortiGate, this produced **blank interface names and every interface showing "down"**, even though SNMP itself was reachable — the embedded SNMP agent couldn't handle two simultaneous walks and returned corrupted data for one of them. Fixed by walking them sequentially (`genericSnmpConnector.js`, `genericSwitchSnmpConnector.js`), and generalized into a proper root-cause fix below.

## What's implemented (Phase 9) — vendor-agnostic chassis/environment auto-detection (ENTITY-MIB)

Any device configured for SNMP should surface as much real information as the device actually exposes — not a fixed, hardcoded list for one vendor. Rather than building a one-off native connector per vendor (e.g. Cisco's own `CISCO-ENVMON-MIB`), both generic SNMP connectors now walk **ENTITY-MIB (RFC 4133) + ENTITY-SENSOR-MIB (RFC 3433)** — IETF-standard tables a broad range of vendors implement (Cisco, Juniper, Arista, HP, Dell, ...), so this works for whichever vendor a device turns out to be, without the user picking one.

- **`monitoring/discovery/entityMib.js`**: walks `entPhysicalTable` for chassis `entPhysicalModelName`/`entPhysicalSerialNum`/`entPhysicalSoftwareRev`, and `entPhySensorTable` (indexed identically, per RFC 3433) for `entPhySensorType`/`entPhySensorOperStatus` on each physical entity classified as a fan/power-supply/temperature-sensor (`entPhysicalClass`). Multiple sensors of the same kind aggregate worst-wins (one failed fan among three still reports the group as critical); an `unavailable` sensor status is excluded, not treated as a failure — never fabricated when a device simply doesn't implement these tables (common on cheaper switches).
- **Populates two previously-always-`null` things**: `Device.model`/`serial`/`version` in the health dialog's "Device" section (real values now, for any vendor supporting ENTITY-MIB — no longer hardcoded to FortiGate's REST API), and a new **Environment** section (Power Supplies / Fans / Temperature, each Healthy/Degraded/Critical) in both the Firewall and Switch health dialogs. `environment` was already part of switch's normalized schema from Phase 4/5 but nothing populated it until now; firewall gained the same `environment` group and health-engine evaluator for the same reason (added to `HEALTH_COMPONENT_KEYS`/`OFFLINE_COMPONENTS`/`EVALUATORS`).
- **`evaluateEnvironment` hoisted into `monitoring/health/commonEvaluators.js`** — identical rule for firewall and switch (any sensor reporting critical/degraded wins; `UNKNOWN` only when the device has no sensor data at all), so it's defined once, not copy-pasted.
- **Root-cause fix for the concurrent-SNMP-walk bug above**: a per-connector `requestQueue.js` (`createRequestQueue()`) that every SNMP call — `getSys`, `getEntity`, `getInterfaces`, `getPoeStatus` — is routed through. Regardless of how `mergeFromConnector`'s `Promise.all` schedules multiple connector methods, the underlying SNMP requests against one device now always execute one at a time. This is more robust than manually sequencing each method's own internal walks (already done for `ifTable`/`ifXTable` in Phase 8) since it also serializes *across* methods (e.g. `getDeviceInfo`'s entity walk vs. `getInterfaces`'s ifTable walk, both invoked concurrently from the same `mergeFromConnector` batch).
- **Tested purely with fake table data** (`test-entity-mib.js`) — no real ENTITY-MIB device needed: chassis extraction, all-healthy aggregation, worst-wins aggregation across multiple sensors, "unavailable" exclusion, and the no-ENTITY-MIB-support case. `test-request-queue.js` proves tasks enqueued together (including via `Promise.all`) never run concurrently, a rejected task doesn't wedge the queue, and results preserve enqueue order.

## What's implemented (Phase 10) — SNMP auto-discovery for the plain `'snmp'` check method

The plain `'snmp'` monitor method (available to every device type, unlike `'connector'` which is firewall/switch only) used to confirm reachability via a single fixed OID and nothing else. It now also runs a broader, read-only discovery pass alongside that check, reusing the exact primitives built in Phase 9 rather than duplicating anything: `snmpProbe` (sysDescr/sysObjectID), `readEntityMib` (chassis model/serial/firmware), and a walk of `ifTable` for an interface count.

- **`services/snmpDiscoveryService.js`**: `discover(device)` runs the three reads sequentially (never concurrently, for the same reason `requestQueue.js` exists) and returns `{sysDescr, sysObjectID, model, serial, version, interfaceCount, discoveredAt}` or `null` if the device didn't answer. `ensureDiscovery(device)` only re-runs the full walk when missing or stale (`DISCOVERY_STALE_MS`, 6h) — same discovery-vs-polling cadence split as the connector pipeline, so a 30-60s poll never re-triggers the whole walk.
- **`Device.snmpInfo`** (new schema field, all-nullable): populated as a best-effort side effect inside `scheduler.js`'s existing `_checkAndUpdate`, only after a successful plain-`'snmp'`-method check, wrapped in try/catch so a discovery failure never affects the device's actual up/down status, and folded into the same `device.save()` call already happening for status updates — no extra DB round-trip.
- **Surfaced in the existing "Status History" dialog** (`DeviceHistoryDialog.jsx`), not a new dialog — a "Discovered info (via SNMP)" card appears right under the "Last check" card whenever any field is populated, since this method has no dedicated health dialog and the history dialog is already available for every device type.
- **`monitor.port` now actually honored by discovery** (it already was by the plain `snmpCheck` in `checks.js`) — `snmpDiscoveryService.js` passes it through, and the shared `snmpTableWalk.js` helper (previously missing a `port` passthrough entirely, unlike `snmpProbe.js`) was fixed to match.

### Real OID bugs found and fixed while testing against a genuine SNMP agent

Every previous SNMP-based test in this project fed pre-built fake JS objects straight into the parsing functions, bypassing the real OID structure entirely — so these bugs shipped in Phase 8/9 without any test catching them. Verifying this feature properly meant spinning up a **real local `net-snmp` `Agent`** with a populated MIB (mirroring the `ssh2.Server` rigor already used for the SSH method), which surfaced three off-by-one-tree-level OID bugs (net-snmp's `tableColumns()` appends `.1.<column>` internally, so the OID argument must be the *table* OID, never the *entry* OID one level deeper) plus one wrong column number, present since Phase 8/9 and affecting every vendor on real hardware:

- **`entityMib.js`'s `ENT_PHYSICAL_TABLE_OID`** was `1.3.6.1.2.1.47.1.1.1.1` (`entPhysicalEntry`) instead of `1.3.6.1.2.1.47.1.1.1` (`entPhysicalTable`) — silently broke chassis model/serial/firmware for every vendor, every device.
- **`entityMib.js`'s `ENT_SENSOR_TABLE_OID`** had the identical bug (`1.3.6.1.2.1.99.1.1.1` instead of `1.3.6.1.2.1.99.1.1`) — silently broke the entire fan/PSU/temperature Environment section. This one wasn't caught by the first pass of real-agent testing either, since that test only populated a chassis row — an independent second review pass (a fresh agent re-reading the diff against the RFCs) is what caught it, then it was confirmed empirically by extending the mock agent to include a real `entPhySensorTable`.
- **`genericSnmpConnector.js` and `genericSwitchSnmpConnector.js`'s `ifXTable` OID** had the same bug (`1.3.6.1.2.1.31.1.1.1` instead of `1.3.6.1.2.1.31.1.1`), meaning the 64-bit octet counters and `ifHighSpeed` (needed for accurate bandwidth on >~3.4Gbps links) never actually populated from a real device.
- **`genericSwitchSnmpConnector.js`'s `PETH_MAIN_PSE_COLUMNS.power`** was column 3 (`pethMainPseOperStatus`) instead of column 2 (`pethMainPsePower`, verified against RFC 3621 text) — the PoE budget reading would have been operational-status noise, not watts. (The table OID itself, `1.3.6.1.2.1.105.1.3.1`, was already correct — a same-shaped "fix" was attempted and then reverted after independent verification against oid-base.com showed the original value was right and the change was a regression.)
- **`test-entity-mib.js`** updated to match the corrected OIDs (its fake responses are keyed by OID string, so they had to move with the fix).

### Testing

`smoke-test.js` spins up a genuine local `net-snmp` `Agent` (via `snmp.createAgent`) with a populated MIB — `sysDescr`/`sysObjectID`/`sysName`, an `entPhysicalTable` chassis row plus fan/PSU/temperature rows, a real `entPhySensorTable`, a real `pethMainPseTable`, `ifTable`, and `ifXTable` — bound to a reserved loopback UDP port. Against this one agent it asserts: a plain-`'snmp'`-method device's `check-now` genuinely discovers model/serial/firmware/interface count/sysDescr (not just "doesn't crash," since the discovery-collection logic only ever runs on the check's success path); a second immediate `check-now` confirms the 6h staleness gate (`discoveredAt` stays unchanged rather than re-running the walk on every poll); and the switch generic connector's `getEnvironment()`/`getPoeStatus()`/`getInterfaces()` read back the real fan/PSU/temperature status, PoE budget/usage watts, and per-interface high-speed values — the exact code paths the OID bugs above lived in.
