# CI selection and acceptance ownership

The `changes` job runs Turborepo 2.9.14's `affectedTasks` query before installing application dependencies or provisioning services. `turbo.json` records package dependency propagation; `apps/sim/turbo.json` partitions the app into shared runtime, server, workspace UI, and acceptance tasks. `.github/ci-suites.json` turns those tasks into job matrices. The uploaded `ci-plan` artifact names changed files, selected tasks, attribution reasons, and any fallback.

A PR compares its merge base with the checked-out merge commit. Pushes and normal manual runs execute all checks. A manual `checks` run can supply a full base commit SHA to reproduce a scoped plan. Missing history, an empty diff, unknown files outside the workspace graph, root script/CI changes, or a planner error run every check. Missing selection outputs fail the aggregate gate. The gate also rejects an omitted dependency, any failed/cancelled job, and any skip that its explicit selection flag did not authorize.

| Change | Expensive checks selected |
| --- | --- |
| Independent SDK | That workspace's tests and type-check; no app build, services, or browsers |
| App unit test | App test shards and test type check |
| Integration test | Both provision paths; no HTTP/browser job merely for the test edit |
| Workspace UI | Mobile and live Electron, plus app tests/build |
| Landing content | SEO, app tests/build; no database integration or Electron |
| Shared runtime or transitive dependency | All dependent boundaries |
| One E2E harness | Its acceptance group and the shared production build |

The server boundary deliberately includes all API routes and backend domains. Shared modules and unclassified app source remain broad inputs: this is safer than pretending a route's static imports describe database, dynamic registry, or background-worker dependencies. Files read outside a package graph need explicit inputs: CLI acceptance imports `packages/sim-cli/src/embed.ts`, app tests read docs content, and live Electron and realtime acceptance cross app boundaries. When adding such a dependency, update the corresponding task inputs/dependencies and the real Git/Turbo selector scenarios.

`affectedTasks` already uses task inputs. Do not enable `futureFlags.affectedUsingTaskInputs` just for this planner: that flag also changes pruning, which can pull CI-only cross-app task dependencies into production Docker contexts.

Affected type-checks follow the package graph too; repository audits and lint always run. Workspace-only unit jobs use a free GitHub runner and do not start the app test shards.

Lightweight HTTP suites and database integration run on free standard GitHub runners. Memory-heavy builds and browser jobs retain appropriately sized Blacksmith runners. Electron uses 4-vCPU Blacksmith: both shards passed within 14 seconds of the 8-vCPU control; the free GitHub rest shard was slower and its lease run stalled.

Every HTTP and browser group consumes the same production build in an isolated job/database. Electron also uses that build and skips its development-route warm-up. Local HTTP and Electron development runs retain their dev-server behavior. Build inputs exclude test-only files so a harness edit can reuse an unchanged production build.

## Coverage removed or consolidated

- SEO is plain HTTP, independent of browser and viewport. Its complete suite runs once in the SEO job, instead of repeating in each of four mobile shards.
- The MCP suite's homepage-returns-200 control duplicated SEO's stronger real-homepage Markdown/content-negotiation check. SEO owns that positive control; MCP retains host isolation, ownership challenge, discovery, API catalogs, unknown-page/API behavior, and refusal of Markdown.
- CLI CI uses one cold/warm-up iteration and one measured iteration instead of three identical measured repetitions. Both retain run completion, selected output, file-reference size, trace, and omitted-workflow-snapshot assertions. The standalone benchmark keeps its configurable sample size.
- A precompiled Electron app needs no route-compilation warm-up, which repeated read/import/chat-switch/Stop flows before each shard. The actual acceptance tests still exercise those behaviors.

The long-import and lease-expiration checks remain: they prove distinct survival/uncertain-outcome behavior across real process failure. Likewise, the two integration provision paths remain because migrations create constraints/triggers that schema push does not.

Local planner validation is `bun run test:scripts scripts/ci-changes.test.ts scripts/ci-gate.test.ts`. It executes real Turbo queries in small Git fixtures; no application build or database is required. Full builds, services, browser suites, and Electron checks run on hosted CI.
