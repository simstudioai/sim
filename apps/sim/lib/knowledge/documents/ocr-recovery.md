# OCR capacity and indexing recovery

Regular KBs and Sim Search use the same connector content pass, document processor, embeddings, and processing continuations. Authorization and source visibility remain specific to each access mode.

## Operating budgets

Mistral enforces organization limits, including requests and OCR pages per minute ([provider documentation](https://docs.mistral.ai/admin/billing-usage/usage-limits)). Configure ceilings below the actual organization allowance, leaving room for other clients. Defaults are operating budgets, not inferred provider quotas:

| Setting | Default | Purpose |
| --- | ---: | --- |
| `KB_CONFIG_OCR_REQUESTS_PER_MINUTE` | 60 | Pace request starts. Also used by the existing Azure limiter. |
| `KB_CONFIG_MISTRAL_OCR_PAGES_PER_MINUTE` | 1000 | Charge submitted pages across workers and tools. |
| `KB_CONFIG_MISTRAL_OCR_PAGES_PER_REQUEST` | 30 | Preferred KB PDF range, bounded by page budget and the provider's 1000-page hard limit. |
| `KB_CONFIG_MISTRAL_OCR_MAX_CONCURRENT` | 2 | Shared active request leases, including body reads. |
| `MISTRAL_OCR_QUOTA_GROUPS` | unset | JSON map of lowercase API-key SHA-256 fingerprints to organization IDs. |

The hosted `MISTRAL_API_KEY` uses a stable shared scope across rotation. Map keys belonging to the same organization to the same group, including the hosted key if it shares quota with mapped BYOK keys. Unmapped BYOK keys are isolated by fingerprint. Separate deployments must use the same backend and group identity to coordinate.

The controller uses the configured Redis backend, or PostgreSQL when Redis is not configured. It fails closed when that backend is unavailable. Deploy migration `0330_provider_capacity_state.sql` before updating the application and Trigger workers; its nullable JSON column is compatible with the previous application.

Page tokens, request pacing, cooldown, and expiring concurrency leases are admitted atomically. A rolling page ceiling also prevents idle token credit from exceeding the configured page allowance in any 60-second interval; conservative one-second buckets retain each charge for up to 61 seconds. A 429 honors `Retry-After`, pauses shared traffic, and halves effective page/request throughput (floor 10%). Concurrent rejections during a cooldown extend it without repeatedly halving. Success restores five percentage points at most once a minute. Effective throughput never exceeds configured ceilings. Leases expire after the enforced request deadline if a worker crashes.

## Recovery and completeness

Indexing waits at admission for at most five seconds. Longer waits, 429s, and Mistral request timeouts leave the immediate retry loop and schedule a durable continuation. The document stays pending with `deferredUntil`; no partial extraction is published. Continuations preserve the source and indexing pass plus billing identity, and rotate a deterministic delivery token so predecessor replays cannot steal a newer continuation. Both Trigger and the in-process backend use delayed delivery.

Successful OCR ranges are checkpointed in private knowledge storage, scoped to KB/document/pass, source bytes, provider/model, request policy, and page range. Reuse requires current model-input provenance. Each bounded object has a fixed 48-hour expiry and cleanup persisted before upload. A failed range stops subsequent batches; a retry reuses verified earlier ranges. Cache reuse still performs bounded PDF splitting but avoids repeated paid OCR.

Capacity recovery is bounded to 48 failed-capacity continuations and 24 hours. Healthy OCR work yields before the worker deadline and resumes after one second, with a separate 512-slice bound and the same 24-hour horizon. Exhaustion stores an actionable failure and reaches the processing-attempt cap so automatic sweeps cannot restart it indefinitely. Changed source content, manual retry, or an explicit full resync can reopen processing after capacity is fixed.

Native PDF indexing reads complete text up to 20 MiB UTF-8, 10,000 pages, and 250,000 raw characters per page, with a 60-second extraction deadline. Hitting a safety limit asks for a smaller document instead of sending a text-heavy PDF to OCR. Documents without usable text still use OCR. The existing 5,000 embedding-chunk cap remains.

Confluence pages with valid, verified empty bodies become successful skips. Search's authored storage bodies can reuse those skips until their source version changes; ordinary KB rendered views are rechecked on scheduled syncs because included pages can change independently of the parent version. Missing/malformed bodies remain source failures. Authoritative skips remove stale indexed content through existing persistence. Full resync can re-evaluate skipped pages.

## Validation and rollout

Run `bun scripts/test-knowledge-acls.ts` for disposable PostgreSQL/Redis tests covering concurrent capacity admission, delayed recovery, indexing, and authorized search. Set `KNOWLEDGE_PROVIDER_LIVE_ENV_FILE` to a selected local environment file to additionally test synthetic content against real OpenAI/Mistral APIs. The harness never uses the production database.

Without Trigger, knowledge outbox handlers receive a bounded 550-second slice. Bundled Docker and Helm schedules use the longer outbox request budget. Custom schedulers or proxies calling the outbox endpoint must permit its 800-second invocation budget.

After deployment, confirm quotas and key grouping, then retry previously failed documents through the normal document retry action. Subsequent Confluence syncs reclassify valid empty pages. Watch `Provider work deferred at shared admission`, `Provider capacity reduced after throttling`, document `deferredUntil`, and terminal capacity failures. Raise ceilings only when the organization allowance supports it; lower pages per request if range latency approaches the request deadline.

Embedding requests use the same durable processing handoff. Each verified, token-sized provider batch is saved to private binary storage before another batch begins on that worker lane. Resumes re-project current inputs, resolve the current provider and load only checkpoints matching the document, indexing pass, full chunk-content hash, batch position, model, endpoint, dimensions, task and credential scope. Customer key changes invalidate reuse; hosted key rotations retain their shared deployment identity. A changed projection produces a different request hash. Inputs that exceed the model limit after projection are refused rather than shortened for indexing.

Each embedding checkpoint holds at most 16 MiB of exact Float64 vectors, expires after 48 hours and has durable cleanup scheduled before upload. Storage operations are capped at 15 seconds and propagate cancellation. Uncached requests reserve their complete 150-second retry budget plus 75 seconds for checkpoint persistence and index commit. An attempt drains its already-admitted requests before scheduling a continuation. Cached batches retain their token usage so the final complete index is charged once under the existing indexing-pass usage identity. No partial vectors become searchable. The document-wide 5,000-chunk limit and bounded provider concurrency still apply.

### OCR input rejection

The shared ingestion path rejects password-protected PDFs, files labeled as PDF without a PDF signature, and animated GIFs before provider admission. GIF validation scans bounded container blocks without decoding frames. A single-image OCR response cannot establish completeness for an animation, so users must export its frames as a PDF or static images. Static GIFs remain supported. Other parser failures can still fall back to OCR when the provider may recover the file.

Provider HTTP 400, 415, and 422 responses are recorded as `ocr_request_rejected`, distinct from invalid source bytes. Automatic Trigger and outbox retries stop, while an explicit retry remains available after repairing the file or correcting the OCR model configuration. Provider error bodies are bounded and discarded; logs and stored failures contain safe HTTP status information, never echoed source content. HTTP 429 and transient service failures retain their existing recovery policy.
