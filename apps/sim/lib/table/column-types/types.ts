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
 * - {@link ColumnTypeServerDefinition} adds the one genuinely server-only
 *   concern: rewriting stored cells inside a transaction on a retype.
 *
 * This mirrors `connectors/types.ts`'s `ConnectorMeta` / `ConnectorConfig`
 * split and its `registry.ts` / `registry.server.ts` pair.
 */

import type React from 'react'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'

/** Every column type id. The registry is keyed by this, which is what makes it exhaustive. */
export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select' | 'currency'

/** Badge colours available to a column-type chip. */
export type ColumnTypeBadgeVariant = 'green' | 'blue' | 'purple' | 'orange' | 'teal' | 'gray'

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

/** Result of coercing a raw value toward a column's declared type. */
export type CoerceResult = { ok: true; value: JsonValue } | { ok: false }

export interface ColumnTypeDefinition {
  readonly id: ColumnType

  /** Human label in the type picker, column header menu, and docs. */
  readonly label: string
  /** Type icon. A component reference only — never invoked server-side. */
  readonly icon: React.ComponentType<{ className?: string }>
  /** Chip colour for the type badge. */
  readonly badgeVariant: ColumnTypeBadgeVariant

  /**
   * Postgres cast needed to compare this type's JSONB text, or `null` when text
   * comparison is correct. Single source for both filter ranges and sort order.
   */
  readonly jsonbCast: 'numeric' | 'timestamptz' | null

  /**
   * Wire operators this type accepts, or `null` for "all operators". Only types
   * whose stored value is opaque (a `select`'s option id) need to restrict.
   * Multi-cardinality variants resolve through {@link filterOperatorsFor}.
   */
  readonly filterOperators: ReadonlySet<string> | null

  /**
   * True when the stored value is an opaque identifier that must be resolved to
   * a display label for search, filtering, export, and clipboard. Only `select`
   * sets this; it is why those paths special-case it.
   */
  readonly storesOpaqueIds: boolean

  /** Whether CSV schema inference may pick this type for an unknown column. */
  readonly inferFromCsv: boolean

  /**
   * Optional `ColumnDefinition` keys this type owns. Any type-specific key
   * present on a column of a *different* type is rejected, generically — a
   * stored `multiple` or `currencyCode` on the wrong type is inert until a
   * later conversion inherits it and silently overrides what that request
   * asked for. Declaring ownership here is what lets a new type add metadata
   * without touching the validator.
   */
  readonly ownedMetadata: readonly ('options' | 'multiple' | 'currencyCode')[]

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
   * Keys that may start a type-ahead edit. `null` means any printable key;
   * `undefined` means type-ahead editing does not apply.
   */
  readonly typeaheadPattern?: RegExp | null
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
   * `currency`'s code). Returns accumulated error messages.
   */
  validateDefinition(column: ColumnDefinition): string[]

  /**
   * Whether an existing cell survives a conversion **to** this type. Reads the
   * value exactly as {@link coerce} will, so the retype gate and the write path
   * cannot drift.
   */
  isCompatibleWith(value: unknown, target: ColumnDefinition): boolean

  /** Stored value → display text (grid cell, CSV, clipboard, width measurement). */
  formatForDisplay(value: unknown, column: ColumnDefinition): string

  /** Stored value → the text an editor input starts with. */
  formatForInput(value: unknown, column: ColumnDefinition): string
}
