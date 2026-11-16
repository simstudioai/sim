# @sim/workflow-sdk

The authoring surface for Sim workflows written as TypeScript. A workflow file imports from this
package, but **nothing in it ever runs**: `@sim/workflow-code` compiles the file statically, and
every runtime export throws `SimSdkNotExecutable`.

This package is a scaffold. The modules below are planned and owned by the Wave 2E agent; `src/`
holds no code yet, so the package has no `exports`, `type-check` or `test` script until they land.

## Planned modules

| Path | Contents |
|------|----------|
| `src/core.d.ts` | Authoring types: `Ref`, `Value`, `Template`, the `t`/`js`/`py`/`sh`/`json`/`md` tags, `ref`, `raw`, `todo`, `file`, `env`, resource constructors (`binding`, `table`, `kb`, `workflow`, `skill`, `customTool`, `mcp`, `sandbox`, `upload`, `picked`), `BlockMeta`, `Node`/`Block`/`Branches`, and `workflow`, `loop`, `parallel`, `condition`, `router`, `note`, `fn` |
| `src/runtime.ts` | The runtime entry: every export throws `SimSdkNotExecutable`, so imports resolve without implying execution |
| `src/codegen/generate.ts` | `generateSdkTypes(catalog, names)`: one `.d.ts` per block from a `BlockCatalog` (`@sim/workflow-code`) and the frozen `apps/sim/blocks/sdk-names.json` |
| `src/codegen/visibility.ts` | The three-way visibility evaluator (always / sometimes / never visible per operation) over serialized catalog conditions |
| `src/codegen/map-subblock.ts` | SubBlock type → TS type mapping |
| `src/codegen/outputs.ts` | Output types, narrowed per operation |
| `src/codegen/names.ts` | Builder, param and identifier naming |
| `src/codegen/emit.ts` | Deterministic `.d.ts` emission |

## Rules the generated surface follows

- A block call is `builder(displayName, params, meta?)`; each operation is its own method, named
  from `sdk-names.json`.
- Param names are subBlock ids; a basic/advanced pair is one param named by its
  `canonicalParamId`, and the mode follows from the value's kind.
- Resource references are call-form: `table('leads')`, `binding('support-slack')`, `kb('docs')`,
  `workflow('enrich')`, `env.NAME`.
- Function code lives in `.js`, `.py` or `.sh` files, stored verbatim.
