# @sim/workflow-sdk

The authoring types for Sim workflows written as TypeScript. A workflow file imports from this
package, but **nothing in it runs**: Sim compiles the file statically, and every runtime export
throws `SimSdkNotExecutable`. The package is private: the CLI embeds its declarations and writes
them into each source directory's `.sim/sdk/`, so no user installs it.

User docs, including the edit loop, the directory layout, the file syntax, exit codes and
diagnostic codes, are at [docs.sim.ai/workflows/code](https://docs.sim.ai/workflows/code)
(source: `apps/docs/content/docs/workflows/code/`). In this repository, the full grammar is
`packages/workflow-code/src/compile/SYNTAX.md`, and the engines' design is in
`packages/workflow-code/DESIGN.md` and `packages/workspace-code/DESIGN.md`.

## Package layout

| Path | Contents |
|------|----------|
| `src/core.d.ts` | Authoring types. Exports exactly `SDK_CORE_EXPORTS` from `@sim/workflow-code`; after editing run `bun run generate:workflow-sdk-embedded-text` from the repository root (`check:workflow-sdk-embedded-text`, part of `bun run check:audits`, fails when it is stale). |
| `cookbook/examples/*.ts` | The examples the CLI writes into `.sim/examples/`. After editing run `bun run generate:workflow-sdk-embedded-text`; `apps/sim/lib/workflows/code/real-catalog.test.ts` type-checks and compiles each against the real catalog (its `COOKBOOK_WORKSPACE` lists the resources they name). |
| `src/runtime.ts` | The runtime entry: every export throws `SimSdkNotExecutable`. |
| `src/codegen/` | `generateSdkTypes(catalog, { blockTypes })` (catalog → `.d.ts` and the `INDEX.md` builder list, for every block or a directory's subset, deterministic, sorted by path), `describeBuilder`/`lookupBuilder` (one builder's params and outputs, for `sim workflows source params`), `generateWorkspaceTypes(manifest)` (`workspace.d.ts`), and `layout.ts`: which declaration files a directory's tsconfig files include. |
| `test/examples` | Five example workflows, also compiled against the real catalog with zero diagnostics in `apps/sim/lib/workflows/code/sdk-examples.test.ts`. |
| `test/negative` | Code each generated type must reject. |

```bash
bun run test                                   # determinism, locality, evaluator, type-check
bun scripts/typecheck-fixtures.ts <outDir>     # sizes, then tsc over test/examples and test/negative
```
