# Add Block Preview Skill

You manage **block visibility gating** in Sim — hiding blocks from every discovery surface (toolbar, cmd+K search, copilot @-mentions, agent tool picker, mothership VFS/metadata/tools, Access Control list, public docs/catalog) while **never** gating execution of already-placed instances.

## The model

Three levers, evaluated in `apps/sim/lib/core/config/block-visibility.ts` and folded into the registry accessors (`apps/sim/blocks/registry.ts`):

1. **`preview: true`** on the `BlockConfig` (static, in code) — the block is default-hidden EVERYWHERE (hosted, self-hosted, dev, SSR) until revealed. Fail-closed.
2. **The hosted `block-visibility` AppConfig document** — per-block rule keyed by the existing block type:

   ```jsonc
   {
     "<block-type>": {
       "enabled": false,        // required. true = GA (visible to everyone)
       "orgIds": ["org_..."],   // optional allowlist clauses (any match reveals)
       "userIds": ["user_..."],
       "adminEnabled": true     // platform admins (user.role === 'admin')
     }
   }
   ```

3. **`PREVIEW_BLOCKS` env** (comma-separated block types) — the off-AppConfig reveal path for self-hosters and local dev.

A revealed block that is not globally GA (`enabled !== true`, or env-revealed) renders with a **" (Preview)"** name suffix on discovery surfaces. `getBlock()` stays pure, so placed instances keep their canonical name and always execute.

## Lifecycle of a preview block

1. **Author** the block normally (`/add-block` etc.) and set `preview: true` on its `BlockConfig`. **Ship no `BlockMeta` and no docs until GA** — `check-block-registry` deliberately skips preview blocks in meta coverage, and `generate-docs` skips them at every gate.
2. **Local dev:** set `PREVIEW_BLOCKS=<block-type>` in your env to see it (with the suffix).
3. **Merge/deploy.** The block's code is live everywhere but visible nowhere — no AppConfig rule exists and self-hosters have no env entry.
4. **Hosted preview:** add a rule to the `block-visibility` AppConfig document and start a deployment (no code deploy):
   - Admins only: `{ "enabled": false, "adminEnabled": true }`
   - Design-partner org: `{ "enabled": false, "orgIds": ["org_123"] }`
   - GA via config (code cleanup pending): `{ "enabled": true }` — suffix disappears everywhere within ~30s (AppConfig TTL) + client refetch.

   Same runbook as `feature-flags`: edit the hosted document, `aws appconfig start-deployment` with the `sim-<env>-fast` strategy (see the infra README).
5. **GA cleanup:** delete `preview: true` from the block (now visible to self-hosters on their next upgrade), add its `BlockMeta` + regen docs, and drop the AppConfig entry. For a v2 upgrade, this is also when v1 gets `hideFromToolbar: true` (the superseded-version paradigm).

## Kill switch (shipped blocks)

To pull an already-GA block from discovery surfaces on hosted (incident, deprecation): add `{ "<block-type>": { "enabled": false } }` to the document. Allowlist clauses can carve out exceptions. **Execution is NOT stopped** — workflows already using the block keep running; the kill switch only prevents new placement/discovery.

## Invariants (do not violate)

- **Execution is never gated.** The executor, serializer, drop-naming, and `isBlockTypeAccessControlExempt` resolve via pure `getBlock`. Do not add visibility checks to execution paths.
- **Clone-not-remove:** gated blocks stay in `getAllBlocks()` output as clones with `hideFromToolbar: true` — `.find`-by-type consumers rely on this. Never filter them out.
- **Keys are registry block types.** Never `custom_block_*` (parse drops them — custom blocks have their own enabled/disabled lifecycle).
- **The shared hidden-predicate is `isHiddenUnder`** (`apps/sim/blocks/visibility/context.ts`). Never restate the preview/disabled rule inline at a new consumer.
- **Process-global caches stay ungated.** `getStaticComponentFiles` (VFS) and `getExposedIntegrationTools` build the ungated universe; per-viewer filtering happens at stamp/consumer time. Never move gating into a shared builder.
- Gating is **surface hiding, not secrecy** — the full config ships in the client JS bundle. Anything truly secret cannot be a registered block.

## Tests

Evaluation semantics: `apps/sim/lib/core/config/block-visibility.test.ts`. Registry projection: `apps/sim/blocks/visibility/visibility.test.ts`. When gating behavior changes, extend those — mock `isPlatformAdmin` for the admin clause; use the local `withAppConfig` harness.
