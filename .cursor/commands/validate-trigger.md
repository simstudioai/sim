# Validate Trigger

You are an expert auditor for Sim webhook triggers. Your job is to validate that an existing trigger implementation is correct, complete, secure, and aligned across all layers.

## Your Task

1. Read the service's webhook/API documentation (via WebFetch)
2. Read every trigger file, provider handler, and registry entry
3. Cross-reference against the API docs and Sim conventions
4. Report all issues grouped by severity (critical, warning, suggestion)
5. Fix all issues after reporting them

## Step 1: Gather All Files

Read **every** file for the trigger — do not skip any:

```
apps/sim/triggers/{service}/           # All trigger files, utils.ts, index.ts
apps/sim/lib/webhooks/providers/{service}.ts  # Provider handler (if exists)
apps/sim/lib/webhooks/providers/registry.ts   # Handler registry
apps/sim/triggers/registry.ts                 # Trigger registry
apps/sim/blocks/blocks/{service}.ts           # Block definition (trigger wiring)
```

Also read for reference:
```
apps/sim/lib/webhooks/providers/types.ts            # WebhookProviderHandler interface
apps/sim/lib/webhooks/providers/utils.ts            # Shared helpers (createHmacVerifier, etc.)
apps/sim/lib/webhooks/provider-subscription-utils.ts    # Subscription helpers
apps/sim/lib/webhooks/processor.ts                  # Central webhook processor
```

## Step 2: Pull API Documentation

Fetch the service's official webhook documentation. This is the **source of truth** for:
- Webhook event types and payload shapes
- Signature/auth verification method (HMAC algorithm, header names, secret format)
- Challenge/verification handshake requirements
- Webhook subscription API (create/delete endpoints, if applicable)
- Retry behavior and delivery guarantees

## Step 3: Validate Trigger Definitions

### utils.ts
- [ ] `{service}TriggerOptions` lists all trigger IDs accurately
- [ ] `{service}SetupInstructions` provides clear, correct steps for the service
- [ ] `build{Service}ExtraFields` includes relevant filter/config fields with correct `condition`
- [ ] Output builders expose all meaningful fields from the webhook payload
- [ ] Output builders do NOT use `optional: true` or `items` (tool-output-only features)
- [ ] Nested output objects correctly model the payload structure

### Trigger Files
- [ ] Exactly one primary trigger has `includeDropdown: true`
- [ ] All secondary triggers do NOT have `includeDropdown`
- [ ] All triggers use `buildTriggerSubBlocks` helper (not hand-rolled subBlocks)
- [ ] Every trigger's `id` matches the convention `{service}_{event_name}`
- [ ] Every trigger's `provider` matches the service name used in the handler registry
- [ ] `index.ts` barrel exports all triggers

### Trigger ↔ Provider Alignment (CRITICAL)
- [ ] Every trigger ID referenced in `matchEvent` logic exists in `{service}TriggerOptions`
- [ ] Event matching logic in the provider correctly maps trigger IDs to service event types
- [ ] Event matching logic in `is{Service}EventMatch` (if exists) correctly identifies events per the API docs

## Step 4: Validate Provider Handler

### Auth Verification
- [ ] `verifyAuth` correctly validates webhook signatures per the service's documentation
- [ ] HMAC algorithm matches (SHA-1, SHA-256, SHA-512)
- [ ] Signature header name matches the API docs exactly
- [ ] Signature format is handled (raw hex, `sha256=` prefix, base64, etc.)
- [ ] Uses `safeCompare` for timing-safe comparison (no `===`)
- [ ] If `webhookSecret` is required, handler rejects when it's missing (fail-closed)
- [ ] Signature is computed over raw body (not parsed JSON)

### Event Matching
- [ ] `matchEvent` returns `boolean` (not `NextResponse` or other values)
- [ ] Challenge/verification events are excluded from matching (e.g., `endpoint.url_validation`)
- [ ] When `triggerId` is a generic webhook ID, all events pass through
- [ ] When `triggerId` is specific, only matching events pass
- [ ] Event matching logic uses dynamic `await import()` for trigger utils (avoids circular deps)

### formatInput (CRITICAL)
- [ ] Every key in the `formatInput` return matches a key in the trigger `outputs` schema
- [ ] Every key in the trigger `outputs` schema is populated by `formatInput`
- [ ] No extra undeclared keys that users can't discover in the UI
- [ ] No wrapper objects (`webhook: { ... }`, `{service}: { ... }`)
- [ ] Nested output paths exist at the correct depth (e.g., `resource.id` actually has `resource: { id: ... }`)
- [ ] `null` is used for missing optional fields (not empty strings or empty objects)
- [ ] Returns `{ input: { ... } }` — not a bare object

### Idempotency
- [ ] `extractIdempotencyId` returns a stable, unique key per delivery
- [ ] Uses provider-specific delivery IDs when available (e.g., `X-Request-Id`, `Linear-Delivery`, `svix-id`)
- [ ] Falls back to content-based ID (e.g., `${type}:${id}`) when no delivery header exists
- [ ] Does NOT include timestamps in the idempotency key (would break dedup on retries)

### Challenge Handling (if applicable)
- [ ] `handleChallenge` correctly implements the service's URL verification handshake
- [ ] Returns the expected response format per the API docs
- [ ] Env-backed secrets are resolved via `resolveEnvVarsInObject` if needed

## Step 5: Validate Automatic Subscription Lifecycle

If the service supports programmatic webhook creation:

### createSubscription
- [ ] Calls the correct API endpoint to create a webhook
- [ ] Sends the correct event types/filters
- [ ] Passes the notification URL from `getNotificationUrl(ctx.webhook)`
- [ ] Returns `{ providerConfigUpdates: { externalId } }` with the external webhook ID
- [ ] Throws on failure (orchestration handles rollback)
- [ ] Provides user-friendly error messages (401 → "Invalid API Key", etc.)

### deleteSubscription
- [ ] Calls the correct API endpoint to delete the webhook
- [ ] Handles 404 gracefully (webhook already deleted)
- [ ] Never throws — catches errors and logs non-fatally
- [ ] Skips gracefully when `apiKey` or `externalId` is missing

### Orchestration Isolation
- [ ] NO provider-specific logic in `route.ts`, `provider-subscriptions.ts`, or `deploy.ts`
- [ ] All subscription logic lives on the handler (`createSubscription`/`deleteSubscription`)

## Step 6: Validate Registration and Block Wiring

### Trigger Registry (`triggers/registry.ts`)
- [ ] All triggers are imported and registered
- [ ] Registry keys match trigger IDs exactly
- [ ] No orphaned entries (triggers that don't exist)

### Provider Handler Registry (`providers/registry.ts`)
- [ ] Handler is imported and registered (if handler exists)
- [ ] Registry key matches the `provider` field on the trigger configs
- [ ] Entries are in alphabetical order

### Block Wiring (`blocks/blocks/{service}.ts`)
- [ ] Block has `triggers.enabled: true`
- [ ] `triggers.available` lists all trigger IDs
- [ ] All trigger subBlocks are spread into `subBlocks`: `...getTrigger('id').subBlocks`
- [ ] No trigger IDs in `triggers.available` that aren't in the registry
- [ ] No trigger subBlocks spread that aren't in `triggers.available`

## Step 7: Validate Security

- [ ] Webhook secrets are never logged (not even at debug level)
- [ ] Auth verification runs before any event processing
- [ ] No secret comparison uses `===` (must use `safeCompare` or `crypto.timingSafeEqual`)
- [ ] Timestamp/replay protection is reasonable (not too tight for retries, not too loose for security)
- [ ] Raw body is used for signature verification (not re-serialized JSON)

## Step 8: Report and Fix

### Report Format

Group findings by severity:

**Critical** (runtime errors, security issues, or data loss):
- Wrong HMAC algorithm or header name
- `formatInput` keys don't match trigger `outputs`
- Missing `verifyAuth` when the service sends signed webhooks
- `matchEvent` returns non-boolean values
- Provider-specific logic leaking into shared orchestration files
- Trigger IDs mismatch between trigger files, registry, and block
- `createSubscription` calling wrong API endpoint
- Auth comparison using `===` instead of `safeCompare`

**Warning** (convention violations or usability issues):
- Missing `extractIdempotencyId` when the service provides delivery IDs
- Timestamps in idempotency keys (breaks dedup on retries)
- Missing challenge handling when the service requires URL verification
- Output schema missing fields that `formatInput` returns (undiscoverable data)
- Overly tight timestamp skew window that rejects legitimate retries
- `matchEvent` not filtering challenge/verification events
- Setup instructions missing important steps

**Suggestion** (minor improvements):
- More specific output field descriptions
- Additional output fields that could be exposed
- Better error messages in `createSubscription`
- Logging improvements

### Fix All Issues

After reporting, fix every **critical** and **warning** issue. Apply **suggestions** where they don't add unnecessary complexity.

### Validation Output

After fixing, confirm:
1. `bun run type-check` passes
2. Re-read all modified files to verify fixes are correct
3. Provider handler tests pass (if they exist): `bun test {service}`

## Checklist Summary

- [ ] Read all trigger files, provider handler, types, registries, and block
- [ ] Pulled and read official webhook/API documentation
- [ ] Validated trigger definitions: options, instructions, extra fields, outputs
- [ ] Validated primary/secondary trigger distinction (`includeDropdown`)
- [ ] Validated provider handler: auth, matchEvent, formatInput, idempotency
- [ ] Validated output alignment: every `outputs` key ↔ every `formatInput` key
- [ ] Validated subscription lifecycle: createSubscription, deleteSubscription, no shared-file edits
- [ ] Validated registration: trigger registry, handler registry, block wiring
- [ ] Validated security: safe comparison, no secret logging, replay protection
- [ ] Reported all issues grouped by severity
- [ ] Fixed all critical and warning issues
- [ ] `bun run type-check` passes after fixes
