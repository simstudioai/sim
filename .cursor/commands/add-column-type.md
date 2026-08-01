# Adding a Table Column Type

A column type is **one file** in `apps/sim/lib/table/column-types/` plus a registry entry. Everything that varies per type — label, icon, storage cast, coercion, validation, conversion compatibility, formatting, editor, filter operators — lives on that one object, so no consumer needs editing.

This was not always true: adding `currency` originally took ~40 edits across 32 `switch` arms and 26 UI branches, each of which failed **silently** when missed. The registry exists to make that impossible, so the rule is absolute: **if you find yourself adding a `case 'yourtype':` anywhere outside `column-types/`, the registry is missing a field. Add the field instead.**

## Hard Rule: the compiler tells you what to do

Do **not** hunt for places to edit. Add your type to the `ColumnType` union first and let `tsc` produce the list:

```bash
cd apps/sim && bunx tsc --noEmit -p tsconfig.json
```

You will get two errors, naming `column-types/registry.ts` and `column-types/registry.server.ts`. Register in both.

If your type owns metadata, adding its key to `TYPE_SPECIFIC_COLUMN_KEYS` produces two more legitimate errors — `FOREIGN_METADATA_VERB` in `validation.ts` (a `Record` over those keys) and the key's absence from `ColumnDefinition`. Those are the gate working, not sites to "fix".

Any error beyond those four is a site reading a hardcoded type list that should read the registry — fix that site, don't work around it.

## Directory Structure

```
apps/sim/lib/table/column-types/
├── types.ts             # ColumnTypeDefinition — the contract you implement
├── types.server.ts      # ColumnTypeServerDefinition — cell migrations only
├── registry.ts          # Record<ColumnType, …>  ← client-safe, the gate
├── registry.server.ts   # Record<ColumnType, …>  ← adds migrations (drizzle)
├── index.ts             # barrel + accessors (columnTypeOf, columnTypeById, …)
└── {type}.ts            # one file per type — what you write
```

## Step 1: Pick the storage shape

Decide what a cell literally holds in `user_table_rows.data` (JSONB). This drives almost everything else:

| Storage | `jsonbCast` | Notes |
|---------|-------------|-------|
| number  | `'numeric'` | Filters/sorts compare numerically. `currency` does this. |
| ISO string | `'timestamptz'` | `date` does this. |
| string / bool / object | `null` | Text comparison is correct. |

**Prefer an existing primitive over a new shape.** `currency` stores a plain number and keeps its ISO code as *display metadata* — which is why filtering, sorting, uniqueness, and CSV export all reuse the numeric paths untouched, and why re-denominating a column rewrites zero rows.

## Step 2: Add the icon

Create `packages/emcn/src/icons/type-{name}.tsx`, copying the geometry conventions of its siblings exactly:

```tsx
import type { SVGProps } from 'react'

/**
 * Type {name} icon component - {what the glyph is} for {name} columns
 * @param props - SVG properties including className, fill, etc.
 */
export function Type{Pascal}(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width='24'
      height='24'
      viewBox='-1.75 -1.5 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.55'
      strokeLinecap='round'
      strokeLinejoin='round'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
      {...props}
    >
      <path d='…' />
    </svg>
  )
}
```

- `viewBox='-1.75 -1.5 24 24'` is the **`type-*` family** value, not the set-wide default. Match the family.
- Center the glyph on the viewBox's optical center (**y = 10.5**, **x = 10.25**) — every sibling does, and a few tenths off is visible at `size-[14px]`.
- Export alphabetically **by component name** in `packages/emcn/src/icons/index.ts`.

## Step 3: Write the type file

`apps/sim/lib/table/column-types/{name}.ts`. Copy the closest existing type and change what differs. Every field is required by the interface, so the compiler enumerates them for you — read the TSDoc in `types.ts` rather than guessing.

The three that are easy to get wrong:

- **`coerce`** is the *single* write-path implementation. The server runs it before persisting **and** the grid runs it to fill the optimistic cache. Accept every shape the value legitimately arrives in (paste, CSV, tool write), because rejecting means the cell is nulled.
- **`isCompatibleWith`** gates type conversion and must read the value **exactly as `coerce` will**, or a conversion will pass its check and then null the cell.
- **`ownedMetadata`** lists the `ColumnDefinition` keys your type owns. Anything you add must also be added to `TYPE_SPECIFIC_COLUMN_KEYS` in `types.ts` and given a phrase in `FOREIGN_METADATA_VERB` in `validation.ts` — both are `Record`-typed, so the compiler will tell you.

## Step 4: Register

Add the entry to `COLUMN_TYPE_REGISTRY` in `registry.ts` **and** `COLUMN_TYPE_SERVER_REGISTRY` in `registry.server.ts`.

`COLUMN_TYPES` is declared in `types.ts` (not derived from the registry — the registry is annotated `Record<ColumnType, …>` against it, which is the gate). `constants.ts` re-exports it, so `columnTypeSchema = z.enum(COLUMN_TYPES)` picks your type up with no edit. **Type-specific metadata does not** — see the next step.

## Step 5: Migrations (only if the stored bytes change)

If converting an existing column **to** your type must rewrite cells, add `migrateCellsTo` in `registry.server.ts`; if converting **away** must rewrite them, add `migrateCellsFrom`.

This is load-bearing, not cosmetic: filters and sorts apply `jsonbCast` to whatever is stored, so leaving a non-castable string behind makes **every query on that column fail** — not merely render oddly.

Prefer set-based SQL. When the transform genuinely needs JS (`currency`'s separator disambiguation), compute the values during the compatibility scan and pass them through `resolved`, then apply them in one batched statement.

## Naming Convention

- Type id: lowercase, singular — `currency`, not `Currency` or `currencies`
- File: `column-types/{id}.ts`, export `const {id}ColumnType`
- Icon: `type-{kebab}.tsx`, export `Type{Pascal}`

## Watch out

- **Import cycles.** `column-types/select.ts` imports `select-values.ts`, so `select-values.ts` must **not** import the registry — that closes a cycle and fails at module init. Inside a type's own helper module the string literal is the implementation, not a config leak.
- **The client-safe boundary.** `registry.ts` and everything it imports must stay free of `@sim/db`, `drizzle-orm`, and `next/server` — the tables grid imports it directly. A React icon is fine (it's a component *reference*, never called server-side). Only `registry.server.ts` may touch drizzle.
- **Don't re-export the registry from `@/lib/table`.** 44 server modules import that barrel; routing this through it pulls `@sim/emcn/icons` into all of them. Deep-import `@/lib/table/column-types`.
- **`import.ts`'s `coerceValue` is a SECOND write path and is not opt-in.** Importing into a column of your type always hits it. Its `default` arm now falls back to the registry's own `coerce` and, on failure, keeps the raw string only when `jsonbCast` is `null` — a numeric/timestamptz column nulls instead, because text left in one makes every filter and sort on that column error in Postgres. So a new type needs **no `case`**; add one only when the import should be *more* forgiving than `coerce` (as `date` and `currency` are). Do not restore a bare `String(value)` fallback.
- **Rendering is a registry hook, not a branch.** `cell-render.tsx` reads `definition.display(value, column)` and switches on the returned `ColumnCellDisplay` kind. If your type draws as plain text you implement nothing. Note `display` also owns the *null* decision: a type that renders when its cell is empty (`boolean`'s unchecked box, `select`'s muted "None") must say so there.
- **CSV inference** is an ordered heuristic in `import.ts`, deliberately not registry-driven. A new type is not inferred from a CSV unless you extend `inferColumnType` — usually you should not, since inference cannot supply configuration (an option set, a currency code).

## If your type owns metadata, read this

Registering the *type* is compiler-enforced. Registering its *metadata* is not, and that is where the remaining manual work lives. A key like `precision` has to be added in each of these, none of which will fail to compile if you forget:

| Where | What happens if you forget |
|---|---|
| `lib/table/types.ts` `ColumnDefinition` | (this one DOES fail — the ownership loop indexes it) |
| `column-types/types.ts` `TYPE_SPECIFIC_COLUMN_KEYS` | it is never stripped on conversion, and poisons the target type |
| `lib/api/contracts/tables.ts` — the schema slot in all three column schemas, plus `refineColumnOptions` | zod strips it at the boundary; silently never saved |
| `columns/service.ts` `addTableColumn` param type | callers cannot pass it |
| `column-config-sidebar.tsx` | no UI to set it |

`normalizeColumn`, `buildConvertedColumn`, the undo snapshot, both column routes, the copilot tool, and the metadata-only update path all read the key list generically, so they are zero-edit.

**Declare ownership in ONE place: `METADATA_KEY_OWNERS` in `column-types/types.ts`.** Each type's `ownedMetadata` derives from it via `ownedKeysOf(id)` — do not hand-write an `ownedMetadata` array. The map lives in `types.ts` rather than on the definitions because that module imports no icons, which is what lets `lib/api/contracts/tables.ts` (client-reachable, and so barred from the icon-carrying registry) enforce the same ownership rule the server does. A key may have several owners: `precision` is shared by `number` and `percent`, which is what lets a column convert between them without the key being stripped in transit.

**There is no longer a per-key update path to copy.** `updateColumnMetadata` in `columns/service.ts` handles every key: ownership from `ownedMetadata`, normalization from `defaultMetadata`, validation from `validateDefinition`. Both routes and the copilot tool route on `metadataKeysIn(updates)` and share the `validateMetadataUpdate` pre-flight in `columns/metadata.ts`. Adding a key needs no edit in any of them.

- If changing your key must **rewrite cells**, declare `migrateCellsForMetadata` on the server entry (`date`'s `includeTime` is the model). It runs inside the same transaction with a scaled statement timeout. Omit it for presentational metadata — a `currency` code or a `precision` must never touch a row.
- If your key needs a **dedicated writer** because changing it rewrites cells *and* needs bespoke guards, set `genericMetadataUpdate: []` and keep that writer. Only `select`'s `options`/`multiple` do this.
- **Adding a key to an existing type is a backward-compatibility question.** Absent is not the same as your default: existing columns have no value for it, and treating them as if they chose your default can silently rewrite their data on the next cell write. `date.includeTime` truncates only on an explicit `false`, and stamps `false` on new columns via `defaultMetadata` — so new columns get the good default and old ones are untouched. Assert both directions in a test.

## Deriving UI from the registry

Do not gate a control on a type name (`typeInput === 'number' || typeInput === 'percent'`). Ask `typeOwnsMetadataKey(type, 'precision')`. This is the leak the Step-2 grep below is most likely to catch in your own diff.

## Checklist Before Finishing

- [ ] Added to the `ColumnType` union in `column-types/types.ts`
- [ ] `column-types/{id}.ts` created, every interface field filled in
- [ ] Registered in **both** `registry.ts` and `registry.server.ts`
- [ ] Icon added, centered on the family's optical center, exported alphabetically
- [ ] `migrateCellsTo` / `migrateCellsFrom` added if the stored bytes change
- [ ] New metadata keys added to `TYPE_SPECIFIC_COLUMN_KEYS` + `METADATA_KEY_OWNERS` + `FOREIGN_METADATA_VERB`, with `ownedMetadata: ownedKeysOf('{id}')`
- [ ] A metadata key added to an EXISTING type leaves columns that predate it behaving exactly as before
- [ ] Unit tests for `coerce` / `isCompatibleWith` round-trips, verified to fail without the code
- [ ] Docs row added to `apps/docs/content/docs/en/tables/index.mdx`

## Final Validation (Required)

1. **`cd apps/sim && bunx tsc --noEmit -p tsconfig.json`** — must be clean. If any file *outside* `column-types/` errors, that file has a hardcoded type list; fix it to read the registry.
2. **Grep for leaks** — `grep -rnE "(===|!==) '{id}'|case '{id}':" apps/sim --include='*.ts' --include='*.tsx' | grep -v column-types/`. (All three forms: a plain `!==` and a `case` are how half of `currency`'s real branches are written.) Hits are expected; judge each. A hit is fine when it mounts a specific React component or encodes a genuinely one-off behavior (`json`'s mono textarea, `date`'s timezone-aware parsing). A hit is a **leak** when it restates something the registry could answer — an icon, a label, a colour, an operator set, a cast, a coercion. Leaks get a registry field, not a new branch.
3. **Run the suite** — `bunx vitest run lib/table 'app/workspace/[workspaceId]/tables' lib/api app/api/table app/api/v1 lib/copilot/tools/server/table`. Existing tests must pass **unchanged**; needing to edit one means you changed behavior for the other types.
4. **`bun run lint:check`, `bun run check:api-validation`, `bun run check:client-boundary`** from the repo root.
5. **Exercise it in the running app** on a table with one column of every type: create, edit inline / in the expanded popover / in the row modal, paste from a spreadsheet, filter, sort, convert to and from other types, export CSV, undo a column delete.
