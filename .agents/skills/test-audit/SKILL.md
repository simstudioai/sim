---
name: test-audit
description: Invoke whenever writing, changing, reviewing, or sweeping tests. Authoring gate for new tests, plus an audit workflow for low-value, implementation-coupled, or duplicative tests and the test-only production seams they demand.
argument-hint: "[author | audit <path> | campaign <subsystem>]"
---

# Test Audit

Three modes, one value bar. **Authoring** gates every new or changed test at write time.
**Audit** runs a focused sweep of existing tests that re-assert source, duplicate stronger proof,
couple to implementation, or keep test-only production seams alive. **Campaign** prunes one
subsystem's whole test surface in parallel lanes. Optimize for confidence, not deletion count —
but a test that cannot name the bug it catches is cost, not coverage.

Read `.claude/rules/sim-testing.md` first: it defines the test layers, file naming, and the
mechanics (global mocks, `@sim/testing`, performance rules).

## The three rules

1. **Never write unit tests after you write code.** A test written to describe code that already
   exists restates the implementation, passes on the first run, and proves nothing. If the change
   needs proof, prove it end to end.
2. **Prefer E2E tests; use them to verify complex features.** Exercise the real boundary — real
   Postgres/Redis (`*.integration.ts`), a running app over real HTTP, or the packaged desktop app
   (Playwright). Every E2E run ends with a **verifiable, repeatable artifact**: a JSON report of
   checks with pass/fail and durations, an HTTP status log, a trace, or a screenshot, written to a
   path the caller controls (`<SUITE>_REPORT_PATH`) and uploaded by CI on failure.
   `apps/sim/scripts/test-scim-e2e.ts` is the reference shape.
3. **If you must test a system in isolation, write the failure modes down first, then write the
   code.** List every way the unit can fail (bad input, boundary, concurrency, partial failure,
   permission denial, resource cap). Each listed mode becomes one test that fails before the code
   exists. A mode you cannot list is not a test you should write.

## Authoring gate

Before adding any test, answer all four. A missing answer means do not add it.

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch that failure? Type-check, `next build`,
   `bun run check:audits`, and the integration/E2E suites are coverage too. Each contract has one
   primary owner at the strongest boundary; another layer needs its own distinct risk. Prefer
   extending an existing table-driven case over a near-duplicate test.
4. Does it need a production seam (export, flag, wrapper, injection hook) that no production
   caller needs? If yes, test at the real boundary instead.

Then check it against every junk pattern below. A match fails the gate unless the retention bar
names the contract it independently guards. A test that would break under behavior-preserving
refactoring asserts implementation, not behavior.

**Regression tests** must fail on the pre-fix code for the intended reason. Revert each guard of
the fix separately and watch the test named for that guard go red, then restore. A regression
test that never demonstrably failed proves the mock, not the fix. One regression at the owner
boundary covers the bug; do not replay it at every layer it crosses.

## Junk patterns

- assertion-free or `toBeDefined()`-only tests; "renders without crashing";
- restating declarations: block/tool/trigger/provider config (subBlock ids, params, outputs, URL
  templates, header maps), constant tables, registries, enums, export lists — type-check and
  `check:audits` own these;
- route/handler tests that mock every collaborator and assert `toHaveBeenCalledWith` on the mocks,
  or re-assert a mock's canned return;
- mocks that implement the asserted behavior, or one mock standing in for different APIs;
- Zod contract tests proving a schema accepts a valid object or rejects an obviously invalid one;
- React tests of text, class names, aria presence, snapshots, "calls onClick";
- hook tests asserting query keys or fetch URLs; store tests of trivial setters;
- tests of test infrastructure (mocks, factories, builders testing themselves);
- source-text or import greps (`readFileSync(src)` + `toContain`);
- expected values produced by the helper under test;
- duplicate invocations of the same contract, or provider-local replays of a shared helper;
- fixtures that supply the ordering, receipt, or callback the owner should produce;
- negative controls that pass for an unrelated reason (a different guard short-circuits first);
- names or fixtures that promise more than the input exercises;
- dead production code or exports whose only callers are tests.

## Retention bar

Keep a test when it independently enforces one of:

- **security** — authn/authz denial, tenant/workspace isolation, SSRF/URL validation, secret
  redaction, encryption, signature verification, path traversal, injection, rate limits;
- **money and data integrity** — billing/usage math, metering, quotas, idempotency, migrations,
  persistence semantics, concurrency/locking/leases, outbox, retries;
- **executor semantics** — DAG traversal, loops/parallels, conditions/routers, reference
  resolution, streaming, pause/resume, run-from-block, cancellation;
- **real algorithms with edge cases** — chunkers, parsers, query builders, cron, diff/merge,
  pagination, encoding, date math, ranking;
- **cross-process wire contracts** — realtime protocol, desktop bridge/IPC, CLI/SDK wire, provider
  webhooks, MCP — that type-check cannot see;
- **a regression with a credible repeat**, shown red on the pre-fix code.

Also keep call ordering when order is observable, and a source inspection when it is the cheapest
independent guard of a user-facing byte, key, or path. A retained test that fails on the baseline
is a possible product bug: reproduce it and fix the owner rather than deleting it. Static or slow
is not a deletion reason.

## Audit mode

Keep discovery read-only and report evidence before editing. Before judging a candidate, read the
complete test and its production owner, callers, sibling implementations, overlapping tests, CI
routing (`.github/workflows/test-build.yml` names DB suites by path), and relevant history
(`git log --format='%h %s' -5 -- <file>`).

Record for every deletion candidate: the test and location; the failure it can actually detect;
non-test callers of the seam it covers; the stronger remaining proof (or why none is needed); the
production or test-support code its deletion unlocks; and the focused validation command.

**Edit shape.** One coherent owner-boundary batch per PR. When pruning inside a file, also delete
now-unused imports, mocks, fixtures, and helpers. Delete test-only exports and dead production
paths instead of preserving aliases (`rg -n '<name>' --glob '!**/*.test.*'` must show no other
reference, including string and dynamic-import references; never delete route files, registry
entries, or generated files). Prefer net-negative production LOC. Do not add replacement tests
that restate the same implementation.

## Campaign mode

For a whole subsystem or the whole repo:

1. Partition test files into lanes of ~150–350 files by owning directory, and list the protected
   set (every `*.integration.ts`, `*.postgres.test.ts`, `__integration__/**`, `apps/desktop/e2e/**`,
   and every path named in `.github/workflows/*.yml`).
2. Give each lane its own git worktree and branch (`git worktree add -b <branch> <path> <base>`,
   then `bun install --frozen-lockfile` inside it). Lanes never share a checkout, never symlink
   `node_modules`, and never use `git stash` — the stash is shared across worktrees.
3. Each lane commits once and writes a report: counts, categories removed with examples, notable
   keeps and why, production seams removed with grep evidence, and the commands it ran.
4. Merge lane branches, then sweep orphaned shared test support (`packages/testing/**`, fixtures,
   helpers) that no remaining test imports.

## Validation

Never edit source or tests while Vitest is running in the same checkout.

1. Run the touched and sibling test files. From `apps/sim`:
   `../../node_modules/.bin/vitest run <paths>` (never `bunx vitest`, which fetches a different
   Vitest). Other workspaces: run from the workspace directory. Never pipe the runner through
   `grep`/`tail` where the pipe hides its exit code.
2. If production code changed: `bun run type-check` in that workspace.
3. `bun run check:audits` from the repo root (some audits list test files by path).
4. `bun run lint`, then `git diff --check`.
5. Report `git diff --shortstat` with production and test changes counted separately.

## Handoff

Report the categories removed, production simplifications, retained false positives and why they
stay, the validation actually run, production vs test LOC, and named follow-ups.
