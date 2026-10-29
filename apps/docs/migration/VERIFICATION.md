# Docs replacement verification

The replacement was implemented from staging commit `01b236388a1fe4d9e609266d5acf265bef1b92c6`. The pre-update checkout was `31f75295216513bd89067a7b8b017cb3fa2be72c`. Paper source measurements and the complete board map are in [paper-design.md](paper-design.md); the behavior parity matrix is in [interfaces-research.md](interfaces-research.md).

Before opening the draft PR, the branch was rebased onto staging `d444d58541`. The intervening changes were confined to platform workflow editing and a resource-sizing comment. The affected workflow-editing suite passed all 45 tests, and all 26 workspace type checks passed again after the rebase. A post-commit regeneration also verified that the migration report stays byte-identical to its formatted committed version.

## Preserved corpus

- 495 authored MDX documents and 308 generated operations across seven specifications and 201 paths.
- 803 catalog entries: 802 readable pages and the existing redirect-only root entry.
- No lost routes, heading anchors, or changed code-fence hashes against the frozen baseline. All 2,147 internal content links validate.
- All 186 original media files are byte-identical. The baseline's remaining asset is an ignored `.DS_Store` operating-system file.
- The 92 changed MDX files contain only 124 component-import replacements. AST comparison found no other content changes. Workflow graph, configuration, and output fixtures are retained.
- Existing agent manifest `.mdx` paths and deliberate exclusions remain unchanged. Product-owned OpenAPI, CLI, integration, streaming, and manifest generators remain authoritative.

The full machine-readable accounting is in [report.json](report.json), with the original inventory in [baseline.json](baseline.json).

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Root lint | 26 workspace tasks passed | `bun run lint` |
| Root type check | 26 workspace tasks passed | `bun run type-check` |
| Repository audits | All 61 passed | `bun run check:audits` |
| Root tests | 634 script tests and all 20 workspace tasks passed; 38,745 application tests passed | `bun run test` with Node 24 |
| Block registry | Canonical IDs, metadata coverage, replacements, and selector coercion passed | Base-sensitive check against staging |
| Migration preservation | Zero lost routes/anchors or changed code-fence hashes | [Migration report](report.json) |
| Complete corpus over HTTP | 2,995 passed | [Corpus report](verification/corpus.json) |
| HTTP and real MCP client | 15 passed | [Interface report](verification/interfaces.json) |
| Content negotiation | 7 passed | [Negotiation report](verification/negotiation.json) |
| Native header merger | 16 passed | [Header report](verification/headers.json) |
| Browser behavior and responsive layouts | 42 passed | [Browser report](verification/browser.json) |
| Isolated PostgreSQL search and publication | 7 passed | [Database report](verification/search-postgres.json) |
| Workflow SSR and hydrated inspector | Authored node text in initial HTML; inspector, Escape, focus restoration, and zero browser errors passed | [SSR report](verification/workflow-ssr.json), [interaction report](verification/workflow-inspector.json) |

The corpus suite found duplicate React Flow accessibility IDs on 15 pages and unusable authentication links on all 308 API pages. Both regressions were observed before their fixes and passed afterward. The retained failure-only reports are [duplicate IDs](verification/corpus-before-preview-fix.json) and [authentication links](verification/corpus-before-auth-fix.json).

A subsequent production-browser review reproduced nested API tabs selecting a media type as the outer response status, hiding the response panels. Both fragment navigation and `beforematch` failed before ownership-aware ancestor selection was added; the complete 42-check browser suite passes afterward. The [pre-fix report](verification/nested-tabs-before-fix.json) records both failures.

The first PR CI run exposed two setup differences from the local verification: the PostgreSQL package command omitted Bun's `react-server` condition, and import audits ran before the ignored MDX registry was generated. The package command now matches the documented local invocation, and CI generates documentation modules before auditing imports. The exact PostgreSQL package command passed all seven checks against a fresh disposable database. Normal content builds no longer load the historical migration inventory or rewrite its report; explicit migration verification still passes and reproduces the report byte-for-byte.

### Performance evidence

SSR-enabled dynamic boundaries keep the workflow renderer out of ordinary reading-page downloads. The introduction page's measured JavaScript fell from 628,703 to approximately 236,000 compressed bytes, a 62% reduction. All seven captured scenes have no document-level horizontal overflow. [Navigation timings and resource sizes](verification/performance.json) include the measurements and runtime context.

Precomputing search chunks moved Markdown parsing out of the request path. The same PostgreSQL fixture's first search service call fell from 4,012 to 15 ms, excluding module import in both measurements. A fresh Bun process took 219 ms to import the service and 9 ms for its first query. The first production HTTP request, including route startup, took 2,531 ms; subsequent requests took 106 and 37 ms. These are distinct measurements, not interchangeable latency claims. See the [fresh-process report](verification/search-cold-process.json) and [HTTP report](verification/search-cold-http.json).

### Visual review

The [component gallery](../app/design-system/page.tsx) imports the same library as the docs. Representative screenshots are included for [introduction](verification/screenshots/introduction-desktop-light.png), [dark mode](verification/screenshots/introduction-desktop-dark.png), [mobile](verification/screenshots/introduction-mobile.png), [API reference](verification/screenshots/api-desktop.png), [Slack](verification/screenshots/slack-desktop.png), [SCIM](verification/screenshots/scim-desktop.png), and the [gallery](verification/screenshots/gallery-desktop.png). Additional captures show [320px](verification/screenshots/responsive-light-320.png), [1024px dark](verification/screenshots/responsive-dark-1024.png), and [1920px](verification/screenshots/responsive-light-1920.png).

## Repeat the checks

Use Bun and the repository's Node 24 runtime. Native dependencies must be installed or rebuilt for that runtime. The local Node 23 installation initially caused TLS API failures; a Node 23 `isolated-vm` binary also could not load under Node 24. Rebuilding that local dependency resolved the remaining loop-test timeouts without changing application code or tests.

From the repository root:

```sh
bun run lint
bun run type-check
bun run check:audits
bun run test
git fetch origin staging
bun run apps/sim/scripts/check-block-registry.ts origin/staging
bun run --cwd apps/docs content:verify-migration
bun run --cwd apps/docs build
```

Start the production docs on a loopback port, then run the suites with caller-selected report paths:

```sh
bun run --cwd apps/docs start --port 3002
```

```sh
export DOCS_E2E_BASE_URL=http://127.0.0.1:3002
DOCS_INTERFACES_REPORT_PATH=/tmp/docs-interfaces.json bun run --cwd apps/docs test:interfaces:e2e
DOCS_NEGOTIATION_REPORT_PATH=/tmp/docs-negotiation.json bun run --cwd apps/docs test:negotiation:e2e
DOCS_HEADER_REPORT_PATH=/tmp/docs-headers.json bun run --cwd apps/docs test:headers:e2e
DOCS_CORPUS_REPORT_PATH=/tmp/docs-corpus.json bun run --cwd apps/docs test:corpus:e2e
DOCS_NAVIGATION_REPORT_PATH=/tmp/docs-navigation.json bun run --cwd apps/docs test:navigation:e2e
```

The isolated PostgreSQL/pgvector setup and `test:search:postgres:e2e` command are documented in [MACHINE_ACCESS.md](../MACHINE_ACCESS.md). That suite requires an empty test database, uses no paid embedding calls, and checks real SQL, freshness, metadata encoding, publication, retirement, and failure preservation. The docs CI workflow runs these production HTTP, corpus, browser, header, and database checks and uploads their reports on failure.

## Scope and limitations

Browser checks cover Chromium at 320, 390, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1440, and 1920 pixels in both themes. They exercise navigation, copy success/failure, search cancellation and focus restoration, persisted theme, tabs, nested disclosures, deep links, media and workflow dialogs, reduced motion, and contained keyboard scrolling. Clipboard permission fallbacks are exercised in Chromium; this is not a claim of a native Safari run or a manual screen-reader audit.

Large integration pages retain their complete SSR content, including collapsed content, for browser find, deep links, and crawling. The largest measured page, Cloudflare, has approximately 10.76 MB of decoded HTML. Local navigation timings and transfer sizes are evidence from a loopback production server, not field Core Web Vitals or mobile-network guarantees.

The optional OpenAI vector path is implemented against the existing embedding contract. Real PostgreSQL keyword search, stale/foreign citation rejection, and lexical degradation were exercised. Live paid embedding generation and production index publication were not run. Publish the index through the existing production workflow and require its freshness check before relying on hybrid results.

Workflow previews retain real shared renderer components and their original data. Their initial HTML includes node text after provider initialization; canvas measurement, final outlines, fit, dragging, and inspection are enhanced during hydration. Fully painted static workflow diagrams would require changes to the shared renderer's geometry lifecycle. The processed Markdown includes complete workflow configuration and outputs independently of JavaScript.

No production deployment, database migration, or shared platform/landing UI change is part of this replacement. Roll back by reverting the docs replacement commit, including its lockfile and workflow changes. Existing search rows remain usable by the prior publisher; no product-data rollback is needed. The PR remains a draft for review.
