# Durable Agent memory

Workflow Agent history uses the existing `memory` row as its conversation identity. A version-1 row retains the legacy JSON-array behavior. Opening a durable Agent turn marks the conversation version 2 under the existing conversation lock; its `data` and provenance sidecar become an immutable prefix. All subsequent ordinary writes append `memory_item` message rows. Complete tool exchanges use private exchange rows, and `agent_memory_turn` stores encrypted recovery state with compare-and-swap revisions.

The Memory API, Memory block, and Pi retain their existing plain-message projection. They concatenate the prefix with message rows and never expose exchange rows, encrypted checkpoints, or private provenance. Workflow Agent reads select complete exchange groups and preserve private provider continuation data separately from enumerable messages. Disabling capture never changes the storage rules for a version-2 conversation.

The memory repository owns storage-version decisions, provenance, and append transactions. `AgentTurnSession` owns one invocation's progress and recorded outcomes; the existing executor still owns retry and fallback policy. Provider capture adapters reuse the existing wire converters, and `conversation-continuation.ts` makes the native-history compatibility decision for both restored history and the current invocation. Incompatible history uses the shared execution-record renderer. Public history, private checkpoints, and large-result artifacts have separate retention and exposure requirements, but share the original conversation owner.

## Deployment

1. Apply the additive migration before rolling out application code. Existing rows default to version 1; no backfill or destructive schema change runs.
2. Roll out readers and writers that understand both versions with durable capture disabled through the `agent-memory-history` AppConfig flag or `AGENT_MEMORY_HISTORY=false` off AppConfig. Drain old workflow workers and in-flight old-build executions before enabling capture: old writers cannot preserve the immutable prefix after a conversation has switched.
3. Enable capture, validate persistence and recovery telemetry, and then make it the deployment default. Conversations switch lazily; API-only conversations remain version 1 until a durable Agent uses them.

Rollback disables new capture while retaining the compatible reader/writer release. Do not roll application code back to a build that only understands version 1 once a conversation has switched. The legacy prefix and its original provenance are retained; no migration copies or deletes it.

## Recovery and deletion

A journal belongs to one execution, workflow, block, node, and execution-order identity. Checkpoint advancement and new completed exchange rows or the final plain response commit in the same transaction; retries deduplicate append keys within the turn. Continuation is used by existing Agent retries and model fallbacks. Existing workflow resumes receive completed conversation history through the normal reader. This adds neither an automatic workflow restart service nor a mid-Agent resume endpoint.

Recorded terminal tool outcomes are reused. Calls with no recorded outcome may run again with their original Sim invocation ID, so continuation provides at-least-once execution, not exactly-once external effects. An external service must support the supplied idempotency key to deduplicate an uncertain effect. A new execution or loop iteration has a separate journal.

New durability failures degrade execution to its in-memory path. They must never cause a version-2 conversation to resume legacy-array writes. API and ordinary memory behavior keep their existing error contract. Deleting a conversation takes the conversation lock and cascades item, journal, and artifact ownership rows. Active turns retain the original memory ID, so a later conversation with the same key cannot accept their stale checkpoint writes.

Large-result artifacts have conversation ownership separate from run-log retention. The cleanup predicate retains owned artifacts and their dependencies while the conversation remains active; deleting the conversation releases this ownership.

Artifact uploads derive legacy uploader attribution from the authorized execution principal using the shared attribution helper. The full result stays encrypted; model-visible history retains an 8,000-character preview of the projected result, with an explicit truncation notice. The preview never uses the protected raw result. Data beyond the preview remains stored but is not automatically added to model context.

Plain compatibility responses admit at most 10,000 appended messages and 16 MiB of new-tail data, private provenance, and row metadata across the entire request. List operations share one budget across conversations. Each page reads SQL size metadata before loading JSON; exceeding either budget returns the existing `payload_too_large` error instead of silently truncating history. Legacy array prefixes retain their existing read behavior.

Version-2 Memory API/Pi appends preflight existing-tail and proposed-message sizes under the conversation transaction lock. A response that would exceed the compatibility budget is rejected before insertion, so retries do not duplicate a write that could never return successfully. Agent private exchanges and journals do not consume this plain-response budget. Rich Agent pages separately preflight SQL sizes and load at most 4 MiB, stopping at the first group that does not fit while preserving every returned exchange intact.

## Verification

The optional five-family live contract suite is `providers/conversation-smoke.test.ts`. It is skipped unless `RUN_AGENT_MEMORY_PROVIDER_SMOKE=true` and `AGENT_MEMORY_PROVIDER_SMOKE_CASES` supplies an array of `{protocol, providerId, model, apiKey?, azureEndpoint?, azureApiVersion?, bedrockAccessKeyId?, bedrockSecretKey?, bedrockRegion?}` entries. Supply one entry for each protocol from `history-adapters.ts`. It executes a mocked, side-effect-free echo tool and then sends the captured native history through a second live request. These calls use provider credits; credentials remain in the environment and must not be committed. The implementation verification did not enable this paid suite.

`conversation-store.postgres.test.ts` creates a disposable schema in a local database selected by `MEMORY_PROVENANCE_TEST_DATABASE_URL`. It applies the additive migration in that schema and checks legacy-prefix preservation, public projections, CAS conflicts and rollback, append deduplication, pair-safe history windows, deletion/recreation, and artifact retention. The schema is dropped after the suite.

The provider regression gate is fixture-only and does not require credentials or incur provider charges. From `apps/sim`, run:

```sh
bunx vitest run providers/openai providers/openai-compat providers/anthropic providers/gemini providers/google providers/bedrock
```

These directories cover the five wire families: OpenAI Responses, Chat Completions, Anthropic Messages, Gemini Content, and Bedrock Converse. The request-history and streaming-loop fixtures exercise the adapters and tool continuation; they are not evidence that a live provider accepted a request. There is no automatic live-provider test gate in this change.

Live smoke verification is an explicitly authorized, manual release step because it incurs charges. Use a disposable workspace and caller-selected models/credentials for each family; never print credentials, native envelopes, or tool results into terminal logs. Run one deterministic read-only tool call, then follow up from persisted memory; repeat with streaming enabled, interrupt after the tool result checkpoint and resume the same invocation, and exercise one cross-family fallback. Confirm the tool is not invoked again when its result committed, the restored answer uses that result, and recorded usage includes both attempts. Do not start these runs merely because credentials are present.

For live V2 workflow tests, `stream: true` selects the SSE response transport. Also pass `selectedOutputs: ['memoryagent.content']` (using the actual normalized Agent block name) to enable provider streaming. Parse the SSE events and assert tool lifecycle events plus successful completion; an SSE final response alone does not prove provider streaming. Azure Chat Completions currently settles tool loops before emitting the answer, so validate its actual provider streaming separately with a tool-free recall of previously stored exchanges.
