# SCIM integration verification

The local integration harness sends real HTTP requests to a running Next.js app
and inspects the resulting PostgreSQL records. It does not mock route handlers,
authentication, application operations, or persistence. Okta and Microsoft Entra
request shapes are emulated; this is not certification against either provider's
provisioning service.

## Requirements

- Bun and the repository dependencies installed.
- A running local app configured for Enterprise SCIM, using a dedicated local
  PostgreSQL database with all migrations applied (including `0325`). Leave
  Redis unconfigured so the app uses PostgreSQL for rate-limit storage.
- The app's local `BETTER_AUTH_SECRET`, at least 32 characters long.
- An app URL using HTTP on `localhost`, `127.0.0.1`, or `::1`. The database must
  also use a loopback host, and its name must include `test` or `scim`.

The harness creates two isolated synthetic organizations, owner accounts, active
Enterprise subscriptions, workspaces, verified `.test` domains, and signed owner
sessions. It obtains bearer tokens through the real administration API. Database
setup also supplies scenarios unavailable through the SCIM API, such as manual
suspension, pre-existing workspace access, and credential expiry.
The rate-limit scenario exhausts only its own connection's database bucket and
verifies that overlapping credentials share it while another tenant remains
unaffected.

Use a disposable database. The harness deletes only its generated fixtures in a
`finally` block. If the process is forcibly terminated, discard the disposable
database or remove the organizations and users whose generated domain starts
with `scim-e2e-`. Existing organizations are not used by the suite.

## Run

From `apps/sim`, set these values for the local app and database, then run:

```sh
export SCIM_E2E_BASE_URL=http://localhost:3000
export SCIM_E2E_DATABASE_URL='postgresql://<local-user>:<local-password>@127.0.0.1:<port>/<test-database>'
export SCIM_E2E_AUTH_SECRET='<the-local-app-BETTER_AUTH_SECRET>'
export SCIM_E2E_REPORT_PATH=/tmp/sim-scim-e2e-report.json
bun run test:scim:e2e
```

The first three variables are required; the report path is optional. The app and
the harness must use the same database and authentication secret. The report
contains check names, outcomes, timing, and HTTP request count; it excludes
bearer credentials, session cookies, and secrets. A failed check exits nonzero
after cleanup. Request redirects are rejected and each request has a 60-second
timeout.

## Coverage

- Discovery, session-authenticated configuration, credential hashing, tenant
  isolation, bearer authentication, content type, and malformed JSON errors.
- User and group creation, reads, replacement, PATCH, deletion, conflict errors,
  stable pagination, count-only queries, and group/member attribute projection.
- Case-insensitive user lookup, external IDs, secondary/work/primary email
  filters, account email drift, and filters reflecting manual suspension.
- Entra-shaped complex name and extension PATCH, case-insensitive core-qualified
  password fields, atomic failure, and partial complex attribute selection.
- Okta display-name updates with an echoed stale formatted name, actual account
  name drift repair, stable retries, optional display-name removal, and group
  member labels falling back to the formatted name.
- Group membership idempotency and membership-only replacement timestamps.
- Workspace, organization-role, and permission-group mappings, reconciliation,
  drift repair, withdrawal, and preservation of pre-existing manual workspace access.
- Managed-membership enforcement through the actual batch invitation and
  workspace permission APIs, including successful edits to unmanaged members.
- Session revocation on deactivation, membership retention, directory
  reactivation, manual suspension protection, owner protection, and account
  relinking after deletion and rehire.
- Credential scopes, overlapping rotation, the active credential limit,
  connection rate limits and retry headers, revocation, connection
  disable/re-enable, expiry, and activity records.

## Continuous integration and PostgreSQL regressions

The `OAuth and SCIM PostgreSQL` job in `.github/workflows/test-build.yml` runs
against both supported database provisioning paths, `db:push` and `db:migrate`.
After the OAuth and SCIM PostgreSQL tests, it starts a local Next.js app with
hosted Enterprise configuration and runs the HTTP suite above. Startup is
bounded to 120 seconds; the server is stopped when the step exits. A failure
uploads the credential-free scenario report and an allowlist of HTTP status log
lines. Raw application logs are not uploaded.

The focused PostgreSQL suite uses the same database variable as the OAuth tests:

```sh
OAUTH_TOKEN_FAMILY_TEST_DATABASE_URL="$SCIM_E2E_DATABASE_URL" \
  bunx vitest run ee/scim/lib/managed-membership.postgres.test.ts
```

Without that variable, the PostgreSQL tests are skipped. With it, they execute
real Drizzle queries against the provisioned schema, covering the invitation
lookup, aliases (including quoted identifiers), unmanaged and foreign-tenant
accounts, disabled and unlocked connections, and the permission guard inside a
transaction. Hosted billing flags are configured for the test; subscription
and entitlement reads use real PostgreSQL with the transaction tripwire enabled.
The suite checks an active Enterprise subscription, an ended one, and a real
billing query failure that must propagate instead of releasing directory locks.
The same CI job runs `lib/auth/sso/application/admit-sso-user.postgres.test.ts`,
which verifies that SCIM's `disableJit` setting blocks fresh SSO membership,
preserves existing membership, and permits JIT when disabled. These checks run
the admission operation and Enterprise entitlement reads through PostgreSQL.

## Live Okta verification

The private **SCIM 2.0 Test App (Header Auth)** has also been exercised through
the Okta Admin Console against an isolated test organization over HTTPS. The
walkthrough and redacted screenshots are in the
[Okta provisioning guide](../../../docs/content/docs/platform/enterprise/scim/okta.mdx).
The run verified credential testing, user assignment and creation, profile
updates, deactivation and reactivation of the same account, group push, workspace
grant and withdrawal, group rename, readdition, repeated push, reconciliation,
token rotation, and downstream group deletion. Resulting names, memberships,
and grants were checked in PostgreSQL as well as the admin interfaces.

This used synthetic users and a seeded verified test domain. It did not exercise
real DNS ownership verification or an end-user SSO login. It is a provider
interoperability check, not OIN certification.

## Live Microsoft Entra verification

A non-gallery enterprise application has been exercised through the Azure
portal against an isolated Sim organization over HTTPS. The
[Microsoft Entra guide](../../../docs/content/docs/platform/enterprise/scim/entra.mdx)
includes the connection, scope, and on-demand screens with private details
redacted.

The run verified connection testing with a raw secret token, direct user
assignment and creation with default mappings (including a minimal profile with
no Mail or structured name attributes), structured-name and display-name
updates, display-name precedence, repeated provisioning without duplicate
accounts, unassignment deactivation, reactivation of the same account, an initial
scheduled cycle, reconciliation, and overlapping token rotation. Entra continued
to match the provisioned user after the old token was revoked; the old token
returned 401 and the replacement returned 200. PostgreSQL checks confirmed stable
SCIM and account IDs, retained membership on deactivation, and no implicit
workspace grants.

The tenant used Entra ID Free. Live group provisioning and group access changes
remain unverified because group assignment requires Premium. Directory account
disablement and deletion also require a scheduled-cycle check; app unassignment
was tested separately through on-demand provisioning. Synthetic users and a
seeded verified domain were used, so this does not verify real DNS ownership,
end-user SSO, or Microsoft gallery certification.

## Provider verification checklist

Before claiming a provider integration has been validated, use an actual Okta
or Microsoft Entra tenant to run its connection test and provisioning job against
an externally reachable test deployment. Verify assignment, profile updates,
group pushes, unassignment, reactivation, and token rotation in the provider's
logs. The local suite does not exercise provider scheduling/retries, provider
portal configuration, real SSO redirects, production rate-limit infrastructure,
or billing-provider webhooks.

Focused unit tests remain useful for malformed payload variants and policy
branches that do not belong in a local HTTP scenario:

```sh
bunx vitest run ee/scim lib/api/server/routes/scim-route.test.ts
```
