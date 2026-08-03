/**
 * The shape of a table column type.
 *
 * Everything that varies per column type — how it looks, how it stores, how it
 * coerces, how it compares in SQL — lives on one of these, so adding a type is
 * "write one file and register it" rather than finding ~40 `switch` arms.
 *
 * Split in two, on the axis that actually constrains us:
 *
 * - {@link ColumnTypeDefinition} is **client-safe**. It may carry a React icon
 *   (an icon is a component *reference*; server code never calls it, and
 *   `scripts/check-client-boundary-imports.ts` only forbids calling a
 *   `'use client'` export from a server surface). It must NOT reach `@sim/db`,
 *   `drizzle-orm`, or `next/server` — the tables grid imports it directly.
 * - `ColumnTypeServerDefinition` (in `types.server.ts`) adds the one genuinely
 *   server-only concern: rewriting stored cells inside a transaction.
 *
 * This mirrors `connectors/types.ts`'s `ConnectorMeta` / `ConnectorConfig`
 * split and its `registry.ts` / `registry.server.ts` pair.
 */

import type React from 'react'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'

/**
 * Every column type id, in picker order. Declared here — not derived from the
 * registry — so `constants.ts` can re-export it without dragging the registry's
 * icon imports into the 44 server modules that read the `@/lib/table` barrel.
 *
 * The registry's `Record<ColumnType, …>` annotation is what keeps the two in
 * step: adding an id here fails compilation until both registries have an entry.
 */
export const COLUMN_TYPES = [
  'string',
  'number',
  'currency',
  'percent',
  'boolean',
  'date',
  'select',
  'email',
  'phone',
  'json',
] as const

export type ColumnType = (typeof COLUMN_TYPES)[number]

/** Which inline editor the grid mounts for a cell of this type. */
export type ColumnCellEditor =
  /** Single-line text input. Numeric types additionally set `inputMode`. */
  | 'text'
  /** Calendar + time picker. */
  | 'date'
  /** Option dropdown. */
  | 'select'
  /** Not editable inline — the grid toggles it in place instead. */
  | 'toggle'
  /**
   * A structured document: monospace multi-line input, pretty-printed when
   * expanded, and a draft that is PARSED on commit so a syntax error surfaces
   * as an editor message instead of being stored as text.
   *
   * Its own variant rather than three separate flags, because those three
   * behaviours always travel together and were otherwise three separate
   * `column.type === 'json'` branches in three modules.
   */
  | 'json'

/**
 * Optional `ColumnDefinition` keys that belong to a specific column type rather
 * than to every column. Each type declares which it owns; a key appearing on
 * any other type is rejected generically, so adding metadata for a new type
 * means extending this list and that type's `ownedMetadata` — not editing the
 * validator.
 */
export const TYPE_SPECIFIC_COLUMN_KEYS = [
  'options',
  'multiple',
  'currencyCode',
  'precision',
  'includeTime',
] as const

export type TypeSpecificColumnKey = (typeof TYPE_SPECIFIC_COLUMN_KEYS)[number]

/**
 * Which column types may carry each type-specific key — the single declaration
 * of metadata ownership.
 *
 * Lives here rather than on the definitions because this module imports no
 * icons, so the API contracts (which are client-reachable and must not pull
 * `@sim/emcn/icons`) can enforce the same rule the server does. Each type's
 * `ownedMetadata` is derived from this via {@link ownedKeysOf}, so the two
 * cannot drift.
 *
 * A key may have several owners: `number` and `percent` both format to a
 * declared number of decimal places, and sharing `precision` is what lets a
 * column convert between them without the key being stripped in transit.
 */
export const METADATA_KEY_OWNERS: Record<TypeSpecificColumnKey, readonly ColumnType[]> = {
  options: ['select'],
  multiple: ['select'],
  currencyCode: ['currency'],
  precision: ['number', 'percent'],
  includeTime: ['date'],
}

/**
 * Keys a column type cannot be created without.
 *
 * Icon-free, alongside {@link METADATA_KEY_OWNERS}, so the API contract can
 * enforce it at the boundary — the contract is client-reachable and must not
 * import the registry. A `select` with no options is not a usable column: every
 * cell would fail option membership on write.
 */
export const REQUIRED_METADATA_KEYS: Partial<Record<ColumnType, readonly TypeSpecificColumnKey[]>> =
  {
    select: ['options'],
  }

/** The type-specific keys a column type owns, for its `ownedMetadata`. */
export function ownedKeysOf(type: ColumnType): readonly TypeSpecificColumnKey[] {
  return TYPE_SPECIFIC_COLUMN_KEYS.filter((key) => METADATA_KEY_OWNERS[key].includes(type))
}

/** Result of coercing a raw value toward a column's declared type. */
export type CoerceResult = { ok: true; value: JsonValue } | { ok: false }

/**
 * How the grid draws a plain (non-workflow-output) cell of this type.
 *
 * Plain data, deliberately — no React here, so the registry stays importable
 * from the server half. The grid owns the actual markup for each kind; the type
 * only says *which* kind its value is, which is what lets a type stop being a
 * `column.type === …` branch in `cell-render.tsx`.
 *
 * `linkable` is text the grid may promote to a favicon link or an in-workspace
 * resource chip — that promotion needs the current workspace id, which is
 * request context the registry has no business holding.
 */
export type ColumnCellDisplay =
  /** Plain text, already formatted. */
  | { kind: 'text'; text: string }
  /** Text that may be promoted to a link / resource chip if it is wholly a URL. */
  | { kind: 'linkable'; text: string }
  /** Monospace one-line JSON. */
  | { kind: 'json'; text: string }
  /** Timestamp string, rendered through the grid's date formatter. */
  | { kind: 'date'; text: string }
  /** In-place checkbox. */
  | { kind: 'boolean'; checked: boolean }
  /** Option pills; the grid resolves ids to options off the column. */
  | { kind: 'select' }
  /** Renders nothing. */
  | { kind: 'empty' }

export interface ColumnTypeDefinition {
  readonly id: ColumnType

  /** Human label in the type picker, column header menu, and docs. */
  readonly label: string
  /** Type icon. A component reference only — never invoked server-side. */
  readonly icon: React.ComponentType<{ className?: string }>
  /**
   * Postgres cast needed to compare this type's JSONB text, or `null` when text
   * comparison is correct. Single source for both filter ranges and sort order.
   */
  readonly jsonbCast: 'numeric' | 'timestamptz' | null

  /**
   * Wire operators a column of this type accepts, or `null` for "all
   * operators". Only types whose stored value is opaque (a `select`'s option
   * id) need to restrict. Takes the column, so a type whose answer depends on
   * its own configuration — select's single vs multi cardinality — owns that
   * rule instead of the registry special-casing it.
   */
  filterOperatorsFor?(column: ColumnDefinition): ReadonlySet<string> | null

  /**
   * The same restriction in the v2 bare-operator grammar, or `null` for "all
   * operators".
   *
   * Declared separately rather than derived from {@link filterOperatorsFor}
   * because the two grammars are not 1:1 — `$empty` splits into
   * `isEmpty`/`isNotEmpty`, and `isNull`/`isNotNull` have no `$` equivalent.
   * Both live on the type so the two wire formats cannot gate differently; when
   * they did, the same filter was accepted or rejected depending only on which
   * shape the caller sent, and the v2 leaf is also what the upsert conflict
   * probe and unique checks compile through.
   */
  predicateOperatorsFor?(column: ColumnDefinition): ReadonlySet<string> | null

  /**
   * Whether a cell of this column holds SEVERAL values (a JSON array) rather
   * than one scalar.
   *
   * Drives array-containment SQL, the `null`/`[]` empty-equivalence in the
   * grid's dirty check, and the default filter operator. Takes the column
   * because it can depend on configuration — a `select` is multi-valued only
   * when `multiple` is set.
   */
  storesMultipleValues?(column: ColumnDefinition): boolean

  /**
   * True when the stored value is an opaque identifier that must be resolved to
   * a display label for search, filtering, export, and clipboard. Only `select`
   * sets this; it is why those paths special-case it.
   */
  readonly storesOpaqueIds: boolean

  /**
   * Whether a column of this type can carry a `unique` constraint. False for
   * types whose stored value is opaque: uniqueness would compare the stored
   * option id, capping each option at one row for the whole table.
   */
  readonly supportsUnique: boolean

  /**
   * Normalizes a SEARCH FRAGMENT for a substring/prefix/suffix filter.
   *
   * Distinct from {@link coerce}, which validates a WHOLE value: a fragment
   * like `+44 20 7123` is not a complete phone number and `coerce` rightly
   * refuses it. But the stored value has had its punctuation stripped, so an
   * ILIKE against the raw fragment matches nothing — the filter is accepted and
   * silently returns no rows.
   *
   * Only types whose canonical form DROPS characters need this. `email` does
   * not: it only case-folds, and ILIKE is already case-insensitive.
   */
  normalizeFilterFragment?(fragment: string): string

  /**
   * Whether `coerce` CANONICALIZES a value rather than passing it through — an
   * email lower-cased, a phone stripped to digits, an amount parsed out of
   * `$1,234.56`, a date normalized.
   *
   * A filter value must be read the same way the cell value was, or the two
   * never meet: a stored `ada@example.com` is not found by an equality filter
   * for `Ada@Example.com`, and a stored `+442071234567` is not found by
   * `020 1234 5678`. JSONB containment compares the canonical forms, so the
   * filter has to produce one.
   *
   * Deliberately its own field rather than inferred from {@link jsonbCast}.
   * That inference was the first attempt and it was wrong in both directions:
   * `email` and `phone` canonicalize but compare as TEXT, so they were skipped
   * and their filters silently matched nothing.
   */
  readonly canonicalizesValues: boolean

  /**
   * Whether this type's values have an ordering, i.e. whether `>`/`<` and a
   * sort mean anything on them. False only for `boolean` and `json`, whose
   * range filters are rejected outright.
   *
   * Distinct from {@link jsonbCast}, which says *how* to compare an orderable
   * value — text when null, otherwise the cast. Conflating the two is what let
   * a text-shaped type fall through a `?? 'numeric'` default and emit
   * `(data->>'email')::numeric`, which errors in Postgres on the first
   * non-numeric row and 500s the entire rows query.
   */
  readonly orderable: boolean

  /**
   * A representative value, used to show an LLM what this column's cells look
   * like. Keeps prompt examples from restating per-type knowledge.
   */
  readonly sampleValue: JsonValue

  /**
   * Optional `ColumnDefinition` keys this type owns. Any type-specific key
   * present on a column of a *different* type is rejected, generically — a
   * stored `multiple` or `currencyCode` on the wrong type is inert until a
   * later conversion inherits it and silently overrides what that request
   * asked for. Declaring ownership here is what lets a new type add metadata
   * without touching the validator.
   */
  readonly ownedMetadata: readonly TypeSpecificColumnKey[]

  /**
   * Which of {@link ownedMetadata} the generic `updateColumnMetadata` writer
   * handles. Defaults to all of them.
   *
   * `select` overrides this to empty: changing its `options` / `multiple`
   * needs an option-removal guard and rewrites every cell between ids and
   * names, so those keep their dedicated `updateColumnOptions` path. Every
   * other key is schema-only (or declares a
   * `migrateCellsForMetadata` in the server registry) and needs no bespoke
   * writer — which is what stops each new key from adding another near-copy of
   * the six that `currencyCode` used to need.
   */
  readonly genericMetadataUpdate?: readonly TypeSpecificColumnKey[]

  /**
   * Owned keys whose change REWRITES stored cells, not just how they render.
   *
   * The client-safe half of `migrateCellsForMetadata` (which lives in the
   * server registry and cannot be imported here). Clients read it to decide
   * whether a metadata edit invalidates cached ROW data as well as the schema:
   * toggling a date column to date-only truncates every stored time
   * server-side, and a grid still holding the pre-migration values disagrees
   * with what filters and exports now see.
   *
   * `column-type-registry.test.ts` asserts this stays in step with the server
   * registry, since nothing else couples the two halves.
   */
  readonly metadataRewritesCells?: readonly TypeSpecificColumnKey[]

  /** Workflow/block param type a column of this type maps onto. */
  readonly workflowInputType: 'string' | 'number' | 'boolean' | 'object'

  /** Inline editor variant. */
  readonly editor: ColumnCellEditor
  /**
   * Whether double-clicking a cell opens the large expanded popover instead of
   * the compact inline editor. True for free-form prose (`string`, `json`)
   * where a cell can hold far more than one line; false for types with a
   * bounded, structured value.
   */
  readonly expandable: boolean
  /** `inputMode` for the text editor, when the type wants a specific keypad. */
  readonly inputMode?: 'decimal'
  /**
   * Whether the editor must accept text an `<input type="number">` would reject.
   * A currency cell legitimately takes `$1,234.56` or `1.234,56`, so it needs a
   * text input with a numeric keypad; a plain number takes neither and keeps
   * the native numeric input with its spinner and validation.
   */
  readonly acceptsFormattedInput?: boolean
  /**
   * Keys that may start a type-ahead edit. Absent means any printable key
   * starts one — only types that parse their input restrict it, so a stray
   * letter can't open an editor whose draft could never save.
   */
  readonly typeaheadPattern?: RegExp
  /**
   * Message shown when a draft cannot be parsed. Absent means any text is
   * valid, so a draft always saves.
   */
  readonly parseErrorMessage?: string

  /**
   * Coerces a non-null raw value toward this type. The single write-path
   * implementation — the server calls it before persisting and the grid calls
   * it to fill the optimistic cache, so the two can no longer disagree.
   */
  coerce(value: JsonValue, column: ColumnDefinition): CoerceResult

  /** Validates a stored cell's shape. Returns an error message, or null when valid. */
  validateCell(value: JsonValue, column: ColumnDefinition): string | null

  /**
   * Validates this type's own column metadata (a `select`'s options, a
   * `currency`'s code). Omitted by types that carry none.
   */
  validateDefinition?(column: ColumnDefinition): string[]

  /**
   * Whether an existing cell survives a conversion **to** this type.
   *
   * Defaults to "whatever {@link coerce} accepts", which is what makes the
   * retype gate and the write path incapable of disagreeing — a gate that is
   * more permissive than the write path reports zero incompatible rows and
   * then rewrites every one of them.
   *
   * An override may only ever be **stricter** than `coerce`, never looser.
   * Stricter is safe: the bulk conversion is refused while individual writes
   * still work. Looser is the direction that corrupts data. Use it when a
   * coercion that is reasonable for a single deliberate write would be
   * destructive applied to a whole column at once.
   */
  isCompatibleWith?(value: unknown, target: ColumnDefinition): boolean

  /** Stored value → display text (grid cell, CSV, clipboard, width measurement). */
  formatForDisplay(value: unknown, column: ColumnDefinition): string

  /**
   * Stored value → the render kind the grid draws for a plain cell.
   *
   * Defaults to `formatForDisplay` as plain text, with a null/undefined cell
   * rendering as `empty`. Override only when the type draws as something other
   * than text — a checkbox, option pills, stars.
   *
   * A type that renders even when its cell is empty (`boolean` draws an
   * unchecked box, `select` draws a muted "None") must say so here, because
   * this hook owns the null decision. That used to be an ordering dependency
   * in `cell-render.tsx`: the two `column.type ===` checks that had to sit
   * above the shared `isNull` early-return, where nothing recorded why.
   */
  display?(value: unknown, column: ColumnDefinition): ColumnCellDisplay

  /** Stored value → the text an editor input starts with. */
  formatForInput(value: unknown, column: ColumnDefinition): string

  /**
   * Human description of a specific column, for the row modal's type hint.
   *
   * Defaults to {@link label}. Override when the type's own metadata changes
   * what a cell means and the editor does not show it: the row modal edits a
   * currency's bare amount, so without the code on screen nothing says which
   * currency the number is in.
   */
  describe?(column: ColumnDefinition): string

  /**
   * Metadata stamped onto a newly created column of this type, so the schema
   * states the type's configuration explicitly instead of leaving readers to
   * know the default. Returns nothing for types that carry no metadata.
   */
  defaultMetadata?(column: ColumnDefinition): Partial<ColumnDefinition>
}
