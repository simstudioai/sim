# QuickBooks sparse-update probe

## The question

Ten update tools in this PR send `sparse: true` to entities whose Intuit developer-docs
pages carry **no** "Sparse update" section:

`CreditMemo`, `Payment`, `Bill`, `BillPayment`, `VendorCredit`, `Purchase`,
`PurchaseOrder`, `Vendor`, `Employee`, `Item`.

Each of those pages states the full-update contract verbatim:

> The request body must include all writable fields of the existing object as returned in
> a read response. Writable fields omitted from the request body are set to NULL.

If QuickBooks honors `sparse` anyway, the missing doc section is a docs-only nit. If it
ignores `sparse` and applies full-update semantics, these tools **silently NULL fields in
customers' accounting books** — a partial update sends only the handful of fields the user
edited, so everything else is wiped.

## Why it blocks the PR

The evidence is genuinely mixed, and neither side can be assumed:

- **Purchase is confirmed broken.** An Intuit support thread reports the structurally
  identical body returning `SystemFault`:
  <https://help.developer.intuit.com/s/question/0D5TR00000qZTfW0AW/systemfault-for-purchase-deposit-sparse-update-operation>
  — *"The variables input contains a field name 'sparse' that is not defined for input
  object type 'Commerce_V3Properties'"*. That same thread says **"This same request was
  working previously"**, so the server behavior **changed**. A passing probe today does
  not guarantee stability; re-run before each release that touches these tools.
- **The docs inventory does not predict behavior.** That thread also names `Deposit`,
  which *does* have a documented sparse section and is reported failing anyway.
- **Absence of a section is sometimes just a docs gap.** The `Payment` page's prose says
  *"A Payment can be updated as a full update or a sparse update"* while the page carries
  no sparse heading at all.

So the only way to settle this is to ask the server.

## Getting sandbox credentials

1. Sign in at <https://developer.intuit.com> and open your app under **My Hub → Apps**.
2. **Keys & credentials → Development** gives you the client id and secret. Development
   keys only ever reach the sandbox host.
3. **Sandboxes** (under your developer account) lists your sandbox companies. The
   **Company ID** shown there is the `realmId`.
4. Open the **OAuth 2.0 Playground** (Tools → OAuth 2.0 Playground), pick your app, select
   the `com.intuit.quickbooks.accounting` scope, authorize against the sandbox company, and
   copy the **access token** (valid 1 hour) and/or the **refresh token** (valid 100 days).

The sandbox company must have its default seed data — the probe resolves a Bank, Expense,
Income and Accounts Payable account plus a Customer, Vendor and Service Item by query, and
fails with a clear message if any is missing.

## Running it

```bash
QUICKBOOKS_ENV=sandbox \
QUICKBOOKS_REALM_ID=<sandbox company id> \
QUICKBOOKS_ACCESS_TOKEN=<fresh access token> \
  bun run apps/sim/scripts/quickbooks-sparse-probe.ts
```

Or let it mint its own access token from a refresh token:

```bash
QUICKBOOKS_ENV=sandbox \
QUICKBOOKS_REALM_ID=<sandbox company id> \
QUICKBOOKS_REFRESH_TOKEN=<refresh token> \
QUICKBOOKS_CLIENT_ID=<development client id> \
QUICKBOOKS_CLIENT_SECRET=<development client secret> \
  bun run apps/sim/scripts/quickbooks-sparse-probe.ts
```

Missing variables are reported by name before anything else happens. Never commit a token.

### Sandbox only — no override

The script **creates and mutates real accounting records**. It refuses to run unless
`QUICKBOOKS_ENV=sandbox` *and* the resolved API host is `sandbox-quickbooks.api.intuit.com`
— two independent checks, so one mis-set variable cannot arm it against a live company.
There is no bypass flag and none should be added. Pointing it at a production realm would
write junk transactions into a customer's books and, if `sparse` really is ignored, destroy
writable fields on every record it touches.

### What it does per entity

`Purchase` runs **first**, deliberately: it is the known-bad case, so if the harness does
not reproduce a failure there, the harness itself is suspect and no other result should be
trusted. `Deposit` and `Invoice` follow as controls — `Deposit` is documented yet reported
failing, `Invoice` is documented and expected to work.

For each entity the script: creates a record with several populated writable fields
(including a multi-line `Line` array where the entity has one) → reads it back and logs the
full payload and `SyncToken` → POSTs
`{"Id":…, "SyncToken":…, "sparse":true, "<one innocuous scalar>":"probe"}` → reads it back
again → classifies.

### Cleanup

Transactions are deleted via `?operation=delete` in reverse creation order (so a
`BillPayment` is removed before the `Bill` it pays). **QuickBooks cannot delete name-list
entities**, so the `Vendor`, `Employee` and `Item` the probe creates are left behind and
printed under `MANUAL CLEANUP REQUIRED` — deactivate them by hand in the sandbox UI.
Anything that failed to delete is listed there too.

## Reading the results

The run prints an entity → classification table and exits non-zero if anything classifies
as `SPARSE_IGNORED_DATA_LOSS`.

| Classification | What the server did | What it means for the tool |
| --- | --- | --- |
| `SPARSE_HONORED` | 200; the probe field changed and `Line` plus every other writable field is intact | `sparse: true` works. Docs-only nit — the tool is correct as written. |
| `SPARSE_IGNORED_DATA_LOSS` | 200, but `Line` emptied or other writable fields nulled | **Ship-blocker.** The tool silently destroys customer data. |
| `SPARSE_REJECTED` | 4xx / `SystemFault` | The tool is non-functional but loses no data. Ship-blocker for functionality, not for safety. |
| `INCONCLUSIVE` | anything else — non-200 non-4xx, probe field not applied, or fields that changed value without being dropped | Read the raw response the script prints and judge by hand. Do not treat as a pass. |

Note on the classifier: fields **dropped** (present before, absent or null after) and a
**shrunken `Line` array** are the data-loss signature. Fields that merely changed value are
reported as `INCONCLUSIVE` rather than blocking, because QuickBooks recomputes some derived
amounts on every save — check those by eye.

## What each outcome implies for the code

Per entity, apply whichever row its classification lands on:

- **`SPARSE_HONORED`** — leave the update tool as-is. Optionally note in a code comment that
  the entity's sparse support is undocumented but empirically verified, with the date the
  probe ran, since the Purchase thread proves this behavior can change under you.
- **`SPARSE_IGNORED_DATA_LOSS`** — remove `sparse: true` and convert that tool to a genuine
  read-modify-write: GET the entity, merge the user's edits over the full read payload,
  then POST the complete object with the fresh `SyncToken`. Nothing may ship for that entity
  until this is done.
- **`SPARSE_REJECTED`** — same fix as above (full read-modify-write), for a different reason:
  the request never succeeds at all, so the tool is dead in the water. Data is safe in the
  meantime, so this can be sequenced after the data-loss cases if triage is needed.
- **`INCONCLUSIVE`** — do not ship that entity on an inconclusive result. Inspect the raw
  request/response the script printed, adjust the probe payload if the entity needed a field
  the probe did not supply, and re-run.

Expected baselines when interpreting a run: `Invoice` should come back `SPARSE_HONORED`
(documented, and the control for "the harness works"). `Purchase` is expected to be
`SPARSE_REJECTED` per the support thread — if it comes back `SPARSE_HONORED`, that is not
automatically good news, it means the server behavior moved again and every other result in
the same run is only a point-in-time snapshot.
