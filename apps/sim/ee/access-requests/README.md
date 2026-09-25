# Permission access requests

Members request access from locked features or the block picker and track their requests in **Settings → Requests** on both workspace and organization surfaces. **My requests** shows the current scope's history, including the member's credit-limit requests, and **Browse access** lists additional requestable access. Organization administrators also have **Review requests** for the organization-wide queue. Saved requester links and authenticated email links resolve to settings; the standalone entry remains available outside the organization Search rollout. Requests are independent of the Enterprise permission-group settings because the same queue handles increases to an administrator-set member credit cap.

## Deployment

1. Apply migration `0349_permission_access_requests.sql` before deploying the application changes.
2. Each organization starts with requests enabled. An explicit organization opt-out disables creation and approval and restores existing feature hiding. History, cancellation, and decline remain available.
3. The existing outbox worker delivers notifications. Email links open authenticated review/history; email never applies a change.

## Policy and lifecycle

- Requests refer to canonical public feature identifiers. Private resource names, preview blocks, deployment-disabled integrations, and unknown tenant model names are excluded from discovery.
- Fulfillment updates the current governing group. The preview lists every required change, including parent restrictions, and a conservative upper bound of affected people/workspaces. It does not create individual grants or move members between groups.
- Approval rechecks administrator authority, requester membership identity, workspace ownership, entitlement at admission, organization preference, group resolution, and the preview fingerprint. Membership, policy, or scope changes require a fresh review or request.
- The group/credit-limit update, final request record, and notification enqueue share one database transaction. The final decision stores its original change and impact for history; later policy edits do not rewrite it.
- One pending request per requester/scope/target is enforced by a database index and organization serialization. Member cap requests share an organization-wide key. Submission is bounded to 100 requests per rolling 24 hours and 100 pending requests per requester/organization, in addition to HTTP rate admission.
- A usage request increases the existing member credit cap. It does not change the pooled organization budget, buy credits, or alter temporary request-rate limits.
- Notifications recheck current membership and reviewer authority. Outbox fan-out is bounded and replay-safe; delivery to an email provider remains at-least-once across a crash after send.

## Validation

Domain and application tests cover denial/delta parity, deployment ceilings, current authorization, duplicate submissions, stale previews, membership changes, monotonic credit increases, and outbox behavior. DOM tests cover locked pages, request-only block actions, keyboard order, and query reconciliation.

The PostgreSQL migration tests run in the integration layer against a disposable local test database:

```sh
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/sim_test bunx vitest run --mode integration permission-access-requests-migration.integration.ts
```

Run that command from `packages/db`. The fixture uses a unique schema and verifies pending uniqueness across independent transactions, lifecycle constraints, default settings, and preservation of decision history.
