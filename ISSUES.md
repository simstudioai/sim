# Open issues — chat-scoped outputs / fork PR (#5401)

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
