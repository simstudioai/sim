# Open issues — chat-scoped outputs / fork PR (#5401)

## Release triage decision (2026-07-05)

All 11 findings below ship as **tracked fast-follows** — none are fixed on
this branch. The feature releases behind the mothership flag via staged
rollout. Conditions of this acceptance:

- The two review-round fixes that landed without tests are now pinned
  (`tool-call-state.test.ts`, `contracts/copilot.test.ts`). The hook-internal
  half of the reconnect-wedge fix (`streamStarted` gating, terminal 404) has
  no testable seam in `use-chat.ts`; extracting one is part of the issue 9
  fast-follow.
- Issues 1 (quota ratchet) and 3 (fork crash window) need monitoring during
  rollout: alert on fork `failedFileCopies` counts and watch storage-quota
  support signals.
- Issues 6, 7, 8, 11 still need the product calls noted inline before their
  fast-follows can be scoped.

## Max-effort review pass (2026-07-05): fixed + fast-follows

A 10-angle adversarially-verified review of the frozen branch surfaced 35
findings (all file:line refs verified). Root cause of the worst cluster: the
by-id resolvers pin `context='workspace'`, so `output` rows were invisible to
every path not explicitly rewired for the third namespace.

**Fixed on this branch** (each with a regression test where a seam exists):

- Model payload drops output tabs — `resolveFileResource` now falls back to
  `resolveChatFileRecordById` and emits paths via the shared
  `chatScopedOrWorkspacePath` (moved to `vfs/path-utils`).
- Output tabs offered a working editor whose every save failed —
  chat-scoped records now render read-only (`resource-content.tsx`).
- CSV outputs >5MB 404'd in CsvTablePreview — the csv-preview route resolves
  via `getPreviewableWorkspaceFile` (owner-gated) and serves from the row's
  real storage context.
- Presign-flow UUID upload ids never resolved as tool inputs — the chat
  by-id fallback in `resolveToolInputFile` dropped its `wf_` prefix gate.

A client-side resume-probe fix for the send-path double-send was attempted
and REVERTED after the gate re-review refuted its premise: run registration
happens at response-construction time (`createRunSegment` inside
`ReadableStream.start`, after the multi-second server prep), so a probe 404s
terminally during exactly the ambiguous window it targets — and the await it
inserted before the rollback opened a new lost-message window on Stop. See R0.

**New fast-follows — correctness/silent-failure (fix in priority order):**

- R0 `use-chat.ts:3436` + `lib/copilot/chat/post.ts` — double-send: a POST
  that dies without a response is blindly rolled back; the queued dispatch
  restores and re-sends a message the server may already be answering.
  Correct fix is server-side: make the send idempotent by `userMessageId`
  (dedupe in `persistUserMessage` / extend the pending-stream 409 to cover
  the post-completion window) or register the run BEFORE prep so a client
  probe can see it. A client probe is only sound after that lands, built on
  an extracted, unit-testable send/reconnect state machine (pairs with
  item 9's fast-follow). Verified nuance (2026-07-05 audit): the user message
  row itself does NOT duplicate — `appendCopilotChatMessages` upserts on
  `(chatId, messageId)` — the duplication is a second full assistant run;
  that upsert is a natural anchor for the idempotency check.
- R1 `workspace-file-manager.ts:500` — trackChatUpload's claim UPDATE has no
  "unclaimed" guard: any re-track of the same key moves `message_id` (fork-cut
  birthdate) to the later message; callers omitting messageId NULL it.
- R2 `chat-file-reader.ts:203` + `workspace-file-manager.ts:1097` +
  `hooks/queries/workspace-files.ts:133` — the swallow-to-success family:
  listChatFiles returns [] on DB error (outputs route 200s), previewable
  lookup returns null on DB error (route 404s), useWorkspaceFileById caches
  null on any error incl. AbortError. Fix as one convention: throw on
  lookup failure, reserve null for not-found/denied.
- R3 `create-file.ts:57` + `workspace-file.ts:359` — create guards reject only
  `outputs/`, not `uploads/` (delete/rename/folders cover both) — an
  `uploads/…` create mints a literal files/uploads/ folder + self-confusion.
- R4 `use-prompt-editor.ts:282` — @-mention completion misses chat outputs
  (`useAvailableResources` called without chatId; needs threading to
  UserInput). Same file offered by the "+" picker.
- R5 `hooks/queries/mothership-chats.ts:684` — forkChat truthiness collapses
  `upToMessageId: ''` into whole-chat duplicate (quota-charged) instead of
  surfacing the contract 400. Latent; both callers currently guard.
- R6 `lib/uploads/server/metadata.ts:168` — empty context array drops the
  context filter (matches ANY context) on an authz-feeding helper; make []
  match nothing. Latent; sits on the access path.
- R7 `doc-compile.ts:150` (inventory finding) — referenced images resolve
  workspace-only; an agent-generated output referenced in a doc silently
  drops. Verified (2026-07-05 audit): `CompileArgs` carries no chatId, so the
  fix needs a signature change — thread `context.chatId` from the callers
  (e.g. `edit-content.ts` already has it) into `compileDoc`, then route
  through resolveToolInputFile.
- R8 (manual testing 2026-07-06, plan test 2) — flag-on `create_file` schema
  contradicts the sim guard: mothership advertises `outputs/<name>` as a
  valid destination (`catalog/files/canonical_resources.go:10`, wired in
  `catalog/files/create_file.go:23`) while sim's server tool unconditionally
  rejects outputs/ targets (`create-file.ts:57`) with advice to "create
  editable files under files/ instead" — so an explicit "create
  outputs/notes.md" reliably lands at `files/notes.md` (leaf only), with the
  agent confidently narrating the fallback. Deterministic, not model flake.
  Deeper gap: NO tool is prompt-encouraged to create a *text* output. The
  only context-threaded path is function_execute's returned-value
  `outputs.files` write (`request/tools/files.ts:260`), but function_execute's
  own description forbids ordinary file creation and points back to the
  dedicated file tools — circular steering. Fix: (a) create_file must use the
  files-only path description regardless of flag (the shared
  `canonicalFileOutputsParameter` stays correct for
  download_to_workspace_file, where outputs/ IS valid); (b) product/prompt
  call on how an explicit text-output request should be fulfilled — bless
  function_execute `outputs.files` for text one-offs, or declare text outputs
  generator-only and fix MANUAL-TESTING test 2's expectation. Note the sim
  guard itself is coherent: create_file allocates an EMPTY file and outputs
  are write-once, so create-then-edit can never produce a text output.
  Companion-repo touch: mothership `catalog/files/create_file.go`.

**New fast-follows — cleanup/altitude batch (one PR, mostly mechanical):**

- Twin display-name allocators: `uploadChatOutput` vs `trackChatUpload`
  (`workspace-file-manager.ts:598`) — unify like the read side.
- Output-ownership rule at three sites (`authorization.ts:271/708`,
  `workspace-file-manager.ts:1087`) — single chokepoint accessor.
- Per-file `incrementStorageUsage` in fork blob copies (`fork-chat-files.ts:205`)
  — accumulate, charge once per fork.
- Eager flag-independent `useChatOutputs` fetch on every chat mount
  (`home.tsx:261`); serialized by-id fallback in `resource-content.tsx:536`.
- Sequential independent awaits: fork route messages+files (`route.ts:121`),
  reference-image/ffmpeg download loops (`generate-image.ts:86`, `ffmpeg.ts:83`).
- Duplicated fork/duplicate title formula client+server
  (`mothership-chats.ts:707` vs fork `route.ts`); duplicated failedFileCopies
  toast (`message-actions.tsx:159` / `sidebar.tsx:980`).
- `isPersistedChatResource` vs shared `isEphemeralResource` (`use-chat.ts:160`);
  vfs grep's own namespace regexes vs canonical predicates (`vfs.ts:50`);
  three-way namespace routing copy-pasted in materialize save/import
  (`materialize-file.ts:137`); context trio threading in resource-writer
  (`resource-writer.ts:305`); fork quota gate re-deriving copyability
  (`route.ts:129`); outputs route hand-rolled 404/500 + manual request-id
  logging in files by-id route (`outputs/route.ts:38`, `files/[fileId]/route.ts:33`);
  decode-fallback inlined 3× (`chat-file-reader.ts:66/120`, `resource-writer.ts:335`);
  ten per-namespace one-line wrappers (`chat-file-reader.ts:257`); fork-route
  skip-update guard re-deriving rewrite internals (`route.ts:195`); mothership
  resource contracts parity-pinned by test instead of shared schema objects
  (`mothership-chats.ts:174`).

Working list of verified findings **not yet fixed on this branch**. These are
candidates to resolve before merge or explicitly sign off on — being listed
here is not acceptance. Each entry links the mechanism, the verified impact,
and the known fix design. Findings already fixed on the branch are not listed.

## 1. Quota is never refunded for chat-scoped bytes (charged by this PR)

- **What:** This PR is the first to charge storage quota for chat-scoped bytes
  (`uploadChatOutput` and fork blob copies both call `incrementStorageUsage`).
  No deletion path in the platform decrements the counter (the only
  `decrementStorageUsage` caller is the content-shrink branch of
  `updateWorkspaceFileContent`), so chat deletion / retention cleanup frees
  the bytes but the counter ratchets up forever. Repeated duplicate+delete
  cycles on a media-heavy chat can walk a user to their plan cap with zero
  net bytes stored, permanently blocking all uploads/outputs/forks
  (`checkStorageQuota` reads the raw counter).
- **Pre-existing context (answering "is there an existing bug here?"):**
  (a) chat uploads were never charged — the presigned mothership path has no
  increment, and multipart *checks* quota but never increments (existing
  inconsistency); (b) workspace files ARE charged and their deletion/purge
  never refunds either — the never-refund convention is platform-wide and
  pre-existing. This PR extends it to a class of bytes that is invisible in
  the Files UI, charged by agent actions, and freed implicitly.
- **Fix design (follow-up migration PR):** add a `quota_charged` marker column
  stamped where the increment happens (fork-copied `mothership` rows are
  otherwise indistinguishable from never-charged originals); refund on both
  cleanup paths keyed to blob-delete success (retry-safe); consider an admin
  reconciliation job (recompute counter from live charged rows). Wrinkles
  documented by verification: collectChatFiles must start selecting
  size/userId/workspaceId; org-vs-personal counter scope is resolved at call
  time so late refunds can land on a different counter (pre-existing hazard).

## 2. Interactive chat DELETE orphans blobs (pre-existing, amplified)

- **What:** Both interactive delete routes (`DELETE /api/mothership/chats/[chatId]`,
  `/api/copilot/chat/delete`) hard-delete the chat row; the `workspace_files`
  FK cascade destroys the rows before any blob cleanup could read the keys —
  blobs orphan in S3 forever. Only the background retention path does
  collect-then-delete (`prepareChatCleanup`). Pre-PR this leaked only chat
  uploads; outputs and fork copies (potentially GBs per duplicate) now leak too.
- **Fix:** make both routes collect blob keys first, delete the chat, then
  best-effort delete the blobs — the exact pattern `prepareChatCleanup`
  already implements. Pairs naturally with issue 1 (same cleanup path).

## 3. Fork crash window leaves committed rows with no blobs

- **What:** The fork transaction commits copy rows, then blobs copy in-process
  post-commit. A crash/deploy restart in that window (minutes for media-heavy
  chats) leaves rows whose reads/serves 404 forever; nothing reconciles
  row-without-blob, and a retried fork mints fresh rows/keys rather than
  healing the old ones.
- **Fix:** move blob copies to a persisted background job (trigger.dev), like
  the workspace fork's `fork-content-copy` task — which also resolves issue 4.
  Interim: a reconciliation sweep or accept with monitoring.

## 4. Fork blob copies have no cross-request memory bound

- **What:** Each fork buffers up to 4 × 100MB concurrently (download buffer
  held through upload); the pool is per-request with no global limiter, so
  N concurrent media-heavy forks can pin N × ~400MB+ on the web process
  (PLAUSIBLE OOM under load).
- **Fix:** module-level semaphore bounding total concurrent blob-copy work
  (~10 lines), or the background job from issue 3, or streaming/provider-side
  copy in storage-service.

## 5. Chat files over 100MB can never survive a fork/duplicate

- **What:** Multipart chat uploads are allowed up to 5GB, but fork blob copies
  download with `maxBytes: MAX_FILE_SIZE` (100MB) — deterministic failure,
  copy row hard-deleted, transcript embeds 404, only a `failedFileCopies`
  count as signal.
- **Fix options:** surface WHICH files were skipped (cheap, honest); streaming
  copy (proper, pairs with issues 3/4); or cap chat upload size to match.

## 6. Chat-scoped glob ignores the pattern past the namespace prefix

- **What:** `glob("outputs/*.png")` returns every output (and the identical
  pre-existing flaw exists for `uploads/`), while the workspace half of the
  same result honors patterns via micromatch — the model gets wrong results
  for specific patterns.
- **Status:** needs clarification with engineering — the uploads behavior is
  pre-existing and the outputs branch deliberately mirrored it for symmetry.
  Fix is one `micromatch.isMatch` filter per branch if we decide patterns
  should be honored (both namespaces should change together).

## 7. Sandbox-export writes can't produce chat-scoped outputs

- **What:** `function_execute`'s sandbox file exports (route-side
  `maybeExportSandboxFilesToWorkspace`) never receive chat context, so an
  interactive `outputs/<name>` export silently lands in workspace `files/`
  (single-file form) or 400s (multi-file form) while the agent references an
  outputs/ path that doesn't resolve. The in-process tool-result writer was
  fixed on this branch; the route half remains.
- **Fix design:** thread `chatId`/`interactive`/`messageId` through the
  function-execute contract's `_context`, and — because this is a lower-trust
  boundary where the caller supplies `_context` — validate chat ownership
  (`copilot_chats.user_id === auth.userId`) before honoring the chat context
  for an outputs/ write.
- **Confirmed mechanism (contract audit):** `functionExecuteContract`'s body
  declares no `_context.chatId`, and the tool body builder
  (`tools/function/execute.ts` ~156) forwards only a whitelist of `_context`
  keys — so the `chatId` the copilot handler stamps into `_context` never
  reaches the route today. The fix must touch the contract, the whitelist,
  and the route.

## 8. Chat namespaces shadow workspace folders named "uploads"/"outputs"

- **What:** With a chatId present, `uploads/…`/`outputs/…` spellings resolve
  only against the chat namespaces, so a real workspace folder literally
  named `uploads` or `outputs` is no longer addressable by its bare spelling
  in resolver-switched tools (the canonical `files/uploads/…` spelling still
  works everywhere, and glob/read hints emit canonical paths). The no-chatId
  case was fixed on this branch (falls through to the workspace resolver).
- **Status:** accept + document, or reserve those two folder names at
  creation time. Needs a product call.

## 9. home.tsx silently drops unresolved file-resource clicks

- **What:** Clicking an agent-emitted file link before the workspace-files or
  chat-outputs query settles logs a warning and does nothing (pre-PR the tab
  opened and resolved lazily). Window is narrow (an invalidation on file
  generation was added) but nonzero; recovery is a second click. home.tsx also
  carries its own copy of the outputs-by-leaf-name matcher that differs subtly
  from resource-content's (raw-encoded leaf matching).
- **Fix:** defer/retry resolution instead of dropping; extract one shared
  leaf-match helper used by both call sites.

## 10. Fork purge can delete another chat's blobs on consolidated-bucket deployments

- **What (mostly pre-existing, narrowed by this PR):** chat-cleanup's second
  key source scoops `fileAttachments[].key` from all messages with no
  ownership check and deletes under a hardcoded `copilot` context. A fork
  whose messages carry unmapped source-chat keys (only soft-deleted or
  workspaceId-less rows since this PR's rewrite; ALL attachments pre-PR) can,
  when purged, delete the source chat's blob — but only when the copilot
  bucket env vars point at the same physical bucket as the workspace bucket
  (non-default, documented-separate deployment shape).
- **Fix:** scope the attachment-key sweep to keys owned by the chat's own
  rows, or drop the hardcoded context in favor of per-row context.

## 11. File-folder resources offered in the picker but rejected on add (pre-existing)

- **What:** the add-resource dropdown offers `filefolder` entries, but the
  copilot POST handler's `VALID_RESOURCE_TYPES` allow-list omits
  `filefolder`/`task`/`generic`, so clicking one 400s ("Invalid resource
  type") and the optimistic tab rolls back. Pre-existing — before the
  contract sync it 400'd at the schema layer instead; same outcome. (The
  sync did fix `integration` adds, which the route allowed but the schema
  rejected.)
- **Fix options:** add `filefolder` to the route allow-list if folders are
  meant to be addable resources (the UI clearly thinks so), or stop offering
  them in the picker. `task`/`generic` look system-managed — likely correct
  to keep un-addable, but confirm.

## Accepted on this branch (for the record)

- **Flag-off writer interception:** with the mothership flag off, a
  hallucinated `outputs/` write path creates a chat-scoped output instead of
  erroring (pre-PR behavior). Accepted: the file persists, is downloadable,
  and appears in that chat's resource picker (flag-independent UI); truly
  gating it would require plumbing the mothership flag into sim. The
  write-once error now names the `files/outputs/…` spelling so a model that
  meant a real workspace folder recovers in one turn.
- **Reference-image strictness and fork quota-charging** are deliberate,
  documented decisions of this PR (see PR body), re-confirmed during review.
