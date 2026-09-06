# Redis Payloads

Rules for anything written to the shared Redis. `sim-caching.md` governs *in-process*
caches; this governs the cluster every process shares.

Redis is one fixed-size box with `maxmemory-policy allkeys-lru` and no AOF. There is no
per-feature quota and no isolation: a key that grows without a bound does not fail its
own feature, it evicts *somebody else's* keys. Idempotency records, usage reservations,
cancellation flags and distributed locks all live there, so an unbounded write is not a
performance problem — it is a correctness problem in a feature you did not touch.

## Cap the bytes, never the count

A count cap is not a memory bound. `ZREMRANGEBYRANK(key, 0, -limit-1)` bounds how many
members a key holds; it says nothing about how large each member is. A key holding 400
members of 250 KB is 100 MB and passes a 100,000-member cap untouched.

Cap the dimension you are actually short of:

```ts
// ✗ Bad — bounds cardinality, not memory
pipeline.zadd(key, seq, JSON.stringify(envelope))
pipeline.zremrangebyrank(key, 0, -EVENT_LIMIT - 1)

// ✓ Good — refuse the write that would exceed the byte budget
const bytes = Buffer.byteLength(payload)
const allowed = await reserveRedisBudget({ ownerId, category, bytes, operation })
if (!allowed) return  // drop, offload, or degrade — but do not write
```

A count cap on top of a byte cap is fine and often useful. A count cap *instead of* one
is the bug this rule exists to prevent — it reads like a guard in review and holds
nothing.

## Use the budget that already exists

`lib/execution/redis-budget.server.ts` is the sanctioned implementation. Three tiers,
enforced atomically in the same Lua as the write:

| Limit | Value | Stops |
|---|---|---|
| `maxSingleWriteBytes` | 8 MB | one pathological value |
| `maxExecutionBytes` | 64 MB | one runaway session |
| `maxUserBytes` | 256 MB | one runaway tenant |

Pair it with `lib/execution/payloads/large-value-ref.ts`: above the threshold the value
goes to blob storage and Redis holds a typed reference instead. Do not write a second
budget module — extend this one to your owner kind.

Any new multi-MB Redis writer must go through it. Today only `event-buffer.ts` and
`user-file-base64.server.ts` do, which is why the copilot stream buffer, the table event
log and the file-doc stream each independently grew a key with no byte bound.

## Never store a value whose size scales with something you do not control

Before writing, name what bounds the value. If the answer is "the size of a user's file",
"the number of tokens the model emits", or "how long the session runs", it is unbounded
and belongs in blob storage behind a reference.

The failure mode to watch for is **re-serialization per event**: emitting a full snapshot
of a growing document on every streamed chunk makes total bytes `O(document × chunks)` —
quadratic in the document, and the client already has every prior byte. Send the delta the
producer usually already computed. A snapshot is a recovery affordance; send it on a
timer, not per chunk.

```ts
// ✗ Bad — every chunk carries the whole document
emit({ content: nextText, contentMode: 'snapshot' })

// ✓ Good — snapshot on an interval, delta in between
const isCheckpoint = now - lastSnapshotAt >= CHECKPOINT_INTERVAL_MS
emit(
  isCheckpoint || !nextText.startsWith(previousText)
    ? { content: nextText, contentMode: 'snapshot' }
    : { content: nextText.slice(previousText.length), contentMode: 'delta' }
)
```

Throttles must cover every branch that can emit. A throttle written for one operation and
keyed on that operation's name silently exempts every sibling added later — bound the
emission, not the operation.

## Sliding TTLs do not expire

`EXPIRE` on every write means the key dies a TTL after the *last* write, not after the
first. For an append-only key under continuous traffic that is never. A sliding TTL is
correct for a session that should outlive its own idle gaps; it is wrong as the only
bound on a key that grows. Pair it with a byte budget, or set the TTL once on creation.

Cleanup that runs only on a clean close is not a bound either — the process that dies
mid-stream is exactly the one holding the largest key.

## Reviewer checklist

For any new or changed Redis write:

- What is the largest this value can be? If you cannot state it in bytes, it is unbounded.
- Is the cap on bytes, or only on entries?
- Does the TTL slide? If so, what stops the key growing between writes?
- Does the write go through `redis-budget.server.ts`? If not, why is this one exempt?
- If it appends per streamed event, does it send deltas, or re-send the whole state?
- If this key grew 100× tomorrow, which *other* feature breaks first?
