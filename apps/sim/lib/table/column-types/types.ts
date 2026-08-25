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
import type { NormalizeDateCellOptions } from '@/lib/table/dates'
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
  'boolean',
  'date',
  'ttl',
  'json',
  'select',
  'reference',
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
  'referenceTableId',
] as const

export type TypeSpecificColumnKey = (typeof TYPE_SPECIFIC_COLUMN_KEYS)[number]

/** Result of coercing a raw value toward a column's declared type. */
export type CoerceResult = { ok: true; value: JsonValue } | { ok: false }

export interface ColumnTypeDefinition {
  readonly id: ColumnType

  /** Human label in the type picker, column header menu, and docs. */
  readonly label: string
  /** Maximum columns of this type a table may contain. Omitted when unlimited. */
  readonly maxPerTable?: number
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
  coerce(
    value: JsonValue,
    column: ColumnDefinition,
    context?: NormalizeDateCellOptions
  ): CoerceResult

  /** Source-owned normalization applied before checking or rewriting a type conversion. */
  valueForConversion?(value: JsonValue, target: ColumnDefinition): JsonValue

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

  /**
   * Last-resort reading of a value {@link coerce} refused, consulted **only**
   * where the write may not fail: a machine-produced value on a path with no
   * caller to answer with a 400 — a computed/enrichment cell, a CSV import row,
   * the cell-write snapshot. The alternative there is not an error, it is a
   * blanked cell, so a lossy-but-faithful reading beats losing the value
   * outright.
   *
   * Omitted by types where nothing is salvageable. Because it never runs on a
   * caller-supplied write it may be looser than `coerce` without weakening what
   * the API refuses — the opposite direction from {@link isCompatibleWith},
   * which may only ever be stricter.
   */
  salvage?(value: JsonValue, column: ColumnDefinition): CoerceResult

  /** Stored value → display text (grid cell, CSV, clipboard, width measurement). */
  formatForDisplay(value: unknown, column: ColumnDefinition): string

  /** Stored value → the text an editor input starts with. */
  formatForInput(
    value: unknown,
    column: ColumnDefinition,
    context?: NormalizeDateCellOptions
  ): string

  /**
   * Metadata stamped onto a newly created column of this type, so the schema
   * states the type's configuration explicitly instead of leaving readers to
   * know the default. Returns nothing for types that carry no metadata.
   */
  defaultMetadata?(column: ColumnDefinition): Partial<ColumnDefinition>
}
