---
paths:
  - "apps/sim/lib/**/*.ts"
  - "apps/sim/providers/**/*.ts"
  - "apps/sim/executor/**/*.ts"
  - "apps/sim/tools/**/*.ts"
---

# In-Process Caching

**Never hand-roll TTL arithmetic.** `lru-cache` is a direct dependency of `apps/sim` and owns
expiry, the ceiling, and — through `fetchMethod` — request coalescing. A
`Map` plus `Date.now() - entry.fetchedAt < TTL` re-implements all three, badly.

## First decide whether it is a cache at all

Most module-level `Map`s in this codebase are **not** caches, and forcing them into one is worse
than leaving them alone.

| Shape | Key dies when | Right tool |
| --- | --- | --- |
| **Lifecycle map** — `activeStreams`, `pendingChildRuns`, `memoryStreams`, `handlerRegistry` | the tracked thing ends, and the code deletes it there | plain `Map`. No TTL, no ceiling. |
| **TTL cache** — a remote read keyed by tenant (org id, user id, workspace id) | time passes | `LRUCache` |

A lifecycle map's key space is unbounded and that is fine, because every key has a defined death.
Adding a TTL to one introduces an expiry that races the lifecycle. Adding a ceiling silently drops
live state.

## TTL caches: always set `max`

```ts
const policyCache = new LRUCache<string, ResolvedSessionPolicy>({
  max: 20_000,
  ttl: SESSION_POLICY_CACHE_TTL_MS,
})
```

`ttl` alone does **not** bound memory. Without `ttlAutopurge` (itself expensive — one timer per
entry) an expired entry lingers until something touches its key or the ceiling evicts it. `max` is
what actually caps the process, which is why a tenant-keyed `Map` grew for the life of the process
before this rule existed.

**The ceiling is a memory backstop, not an operating limit.** Exceeding it makes the LRU evict
*inside* the TTL, so each miss becomes one more read — never a wrong answer, it degrades to exactly
the pre-cache behavior, but it is a hit-rate cliff on whatever path the cache sits on. Entries are
tens of bytes, so set the cap far above any plausible per-instance working set within the TTL
window and let it stay a backstop.

**Reads test `!== undefined`, not truthiness**, whenever the value can be `false`, `0`, or `null`.
`if (cached)` on a cached `false` re-queries on every single call, for exactly the tenants the
cache exists to protect.

## Async read-through: prefer `fetchMethod`

`fetchMethod` + `cache.fetch(key)` gives TTL, coalescing (concurrent callers share one promise),
and eviction-on-rejection (`noDeleteOnFetchRejection` defaults to `false`) in one primitive. Reach
for it before composing anything yourself.

**The one reason to compose instead: a hung producer.** `fetchMethod` has no settle deadline, and
the app pool sets no `statement_timeout` (`packages/db/db.ts` sets only `connect_timeout` /
`idle_timeout`, neither of which bounds a query already in flight). Where a wedged read would hold
every caller for the whole TTL, wrap `coalesceLocally` from `@/lib/concurrency/singleflight` around
a read-through `LRUCache` instead — it evicts and rejects at its deadline. See
`lib/api-key/byok-entitlement.ts`, and `lib/oauth/credential-service.ts` for the same shape.

Do **not** build a house wrapper over `lru-cache`. Call sites differ in ways a thin helper cannot
hold (synchronous memoization with `updateAgeOnGet` in `providers/client-cache.ts`, per-entry TTLs
in `lib/auth/security-policy.ts`), so a wrapper covering the common case just adds a fourth pattern.

## Cache the gate, never the credential

Entitlements, plans, and policies tolerate bounded staleness **in the safe direction** — a lapsed
organization keeping its own provider key for another minute costs a little metering and charges
nobody wrongly. Key material does not: revocation has to be immediate, so
`getBYOKKey` reads key rows fresh on every call and caches only the entitlement around them.

An outage must not be cached as a negative answer. A resolver that maps a failed read to `false`
makes an outage indistinguishable from a real lapse, so give it an `onError: 'throw'` option and
write the cache only on the success path — see `resolveOrganizationPlan`.

**Where a human is waiting, read fresh.** Keep two entry points rather than one cached function:
the settings surfaces and management use cases must not tell an organization that just upgraded
that it still lacks a plan, while the execution path underneath can serve from cache
(`isOrganizationBYOKEntitled` vs `isOrganizationBYOKEntitledCached`).

## React `cache()` does nothing in a worker

`cache()` is request-scoped. Workflows run in Trigger.dev workers, which have no React request
scope, so a `cache()`-wrapped gate that looks free on a settings page is uncached and per-block on
the execution path. Anything reached from the executor needs a real cache — see
`.claude/rules/sim-architecture.md`'s app/worker runtime boundary.

## Invalidation

Add a per-key invalidator only when the code that mutates the value runs in the **same process**
that reads it. `invalidateSessionPolicyCache` works because the route writing the policy is the one
serving the reads. An entitlement change arriving on a Stripe webhook lands in one process while
the readers are per-worker, so an invalidator there would imply an immediacy it cannot deliver —
the TTL is the real mechanism, and the absence of an invalidator should say so.
