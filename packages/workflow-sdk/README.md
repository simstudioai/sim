# @sim/workflow-sdk

The authoring surface for Sim workflows written as TypeScript. A workflow file imports from this
package, but **nothing in it ever runs**: `@sim/workflow-code` compiles the file statically, and
every runtime export throws `SimSdkNotExecutable`.

## Modules

| Path | Contents |
|------|----------|
| `src/core.d.ts` | Authoring types: `Ref`, `Value`, `Template`, the `t`/`js`/`py`/`sh`/`json`/`md` tags, `ref`/`raw`/`todo`/`file`/`env`, resource constructors, `BlockMeta`, `Node`/`Block`/`Branches`, `workflow`, `loop`, `parallel`, the special builders (`condition`, `router`, `fn`, `runWorkflow`, `human`, `response`, `setVariables`, `note`), `edge` and the generic `block`. It exports exactly `SDK_CORE_EXPORTS` from `@sim/workflow-code` |
| `src/runtime.ts` | The runtime entry: every export throws `SimSdkNotExecutable` |
| `src/codegen/` | `generateSdkTypes(catalog)` (block catalog → `.d.ts`) and `generateWorkspaceTypes(manifest)` (`workspace.d.ts`) |

## Generated files

`generateSdkTypes` returns files sorted by path, byte-identical for the same catalog:

- `blocks/{type}.d.ts`: augments `@sim/workflow-sdk` with that block's builders, tool forms
  (`slack.tool.sendMessage(...)`) and `SpecialBuilderTypes` entries.
- `operations/{type}/{operation}.d.ts`: one operation's params and output types.
- `models.d.ts`: model ids, apart so a model-list change touches one file.
- `index.d.ts`: imports the rest; the only file that names the catalog hash.

Builder names come from the catalog's frozen `builders` map; codegen never invents one. Param
names are subBlock ids, or the `canonicalParamId` of a basic/advanced pair. Each operation's
params are narrowed by the visibility evaluator: always visible (required when the field is
required and has no default), sometimes visible (optional, with `@when`), never visible (dropped).
One small dropdown that gates disjoint fields becomes one nested union level.

## Checking the generated types

```bash
bun run test                                   # determinism, locality, evaluator, type-check
bun scripts/typecheck-fixtures.ts <outDir>     # sizes, then tsc over test/examples and test/negative
```

`test/fixtures/catalog.json` is projected from 18 real registry blocks; `test/examples` are the
five s2 example workflows, and `test/negative` holds code each generated type must reject.
