# Shopify privacy operations

The webhook receiver records requests for all three mandatory compliance topics.
Receipt is separate from fulfillment. The outbox marks a case ready for review;
it never deletes customer data or completes a case automatically.

Retries deduplicate by app and `X-Shopify-Webhook-Id`. Separate delivery IDs retain
separate cases even when their payloads match, because a later deletion request
can have the same body as an earlier obligation. A reused delivery ID with a
different payload or topic is rejected.

The privacy policy's designated owner is responsible for the queue. No external
notification is sent by this implementation. The existing outbox maintenance
marks requests with seven days or less remaining for escalation and logs their
opaque case IDs. Production cron and worker dispatch must be active.

## Operator API

These routes require a current platform administrator session and recheck role
on the primary database. Ordinary workspace administrators, API keys and the
Shopify webhook principal have no access.

- `GET /api/admin/shopify/privacy?openOnly=true&limit=50` lists cases. Follow
  `nextCursor` using `after` to read subsequent pages.
- `GET /api/admin/shopify/privacy/{requestId}` reads the original request,
  evidence and up to 100 historical ownership associations. Follow
  `nextScopeCursor` using `afterScope` to enumerate every association.
- `POST /api/admin/shopify/privacy/{requestId}` accepts an `action` and the
  currently observed `revision`. `assign` assigns the case to the caller;
  `record_evidence` records reviewed storage categories; `legal_hold` records
  an unresolved retention requirement; `complete` verifies the evidence and
  records the completing operator and timestamp. A stale revision is rejected.
  Each mutation atomically retains an audit entry with the case ID, acting
  administrator, action, revision, status change, assignment, and category names;
  customer payloads and evidence summaries are excluded from audit entries.

Evidence entries contain `store`, `outcome`, `recordReference`, and `summary`.
Use opaque references to secured operational records and avoid copying customer
PII into summaries. Evidence is encrypted at rest. `record_evidence` also carries
`scopeReviewed` and, for a data request, a `deliveryReference` for secure delivery
to the verified store owner. Completion requires evidence for installation
scope, executions, chats, files, tables, knowledge, saved workflows, external
processors, and backups. `legal_hold` keeps a request unfinished.

## Required fulfillment work

Automatic discovery currently enumerates installation ownership only. The
request payload is available for investigation. It is not a customer-data
export. An operator must inventory stored data in every listed category, resolve
shared or transformed copies, carry out the export or permanent erasure using
the relevant storage lifecycle, and record verifiable evidence. Ordinary file
archive and OAuth credential removal do not establish that fulfillment occurred.
Cases with unknown historical ownership or unresolved copies must remain open.

Completion removes the encrypted raw webhook payload. Restricted evidence and
case metadata remain for accountability. The operational retention policy for
that evidence, historical installation associations, backup restores, and
subprocessor copies must be established before App Store readiness is claimed.

## Deployment and verification

Apply the additive migration before deploying the app and worker. Configure the
public app's Shopify client ID and secret on the app server, and encryption and
database access on both app and worker. Backfill existing installations before
relying on the new history; current hooks record new claims and OAuth draft
completion, while pre-existing disconnected installations require investigation.
Expired installation handoff secrets are removed in bounded outbox maintenance.

After production receiver and operations are ready, configure the three
`compliance_topics` (`customers/data_request`, `customers/redact`, `shop/redact`)
against `/api/webhooks/shopify/privacy` in the Shopify app configuration or
dashboard. No subscription is created by deploying this code alone.

Run the disposable database suite from the repository root with
`SHOPIFY_PRIVACY_REPORT_PATH=<report.json> bun run test:integration lib/shopify/privacy/requests.integration.ts`.
The report records real HTTP and PostgreSQL checks. A synthetic webhook test
does not verify active Shopify subscriptions or production fulfillment.

Provider requirements: [privacy law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
and [delivery verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).
