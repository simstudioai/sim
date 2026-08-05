/**
 * Domain model for workspace interfaces — grid pages composed of chat, table,
 * file, and form modules wired to workspace resources.
 *
 * This file is the source of truth for the interface wire shapes. The HTTP
 * contracts (`@/lib/api/contracts/interfaces`), the service layer, and the
 * copilot tool all pin to these types.
 *
 * @remarks
 * The grid is **data, not a constant**. A layout carries its own
 * {@link InterfaceGrid} and every module carries a rectangular
 * {@link InterfacePlacement}, so the shape of the page is described by the
 * stored document rather than assumed by the code that reads it. Nothing in
 * the domain, the validator, or the renderers is written against a fixed
 * number of tracks: today {@link DEFAULT_INTERFACE_GRID} mints new interfaces
 * as 2x2 with `1x1` modules, and moving to 3x4, to a single full-bleed pane,
 * or to modules that span several tracks is a change to that default and to
 * the authoring affordances — not to the schema, the persistence layer, or
 * the collapse rules.
 *
 * All grid arithmetic lives in `@/lib/interfaces/geometry`; no other module
 * should compare rows and columns by hand.
 */

/**
 * Every module type, in no particular order. Runtime guards, the contract
 * enum, and the copilot tool all derive from this tuple so widening the union
 * is a single edit that cannot silently miss a validator.
 */
export const INTERFACE_MODULE_TYPES = ['chat', 'table', 'file', 'form'] as const

export type InterfaceModuleType = (typeof INTERFACE_MODULE_TYPES)[number]

/**
 * The two shapes an interface renders in: the authoring grid, and the page as
 * it ships. Declared in the domain rather than beside the editor's URL parsers
 * because both the editor and the view render against it, and the view must not
 * import from a route.
 */
export const INTERFACE_MODES = ['edit', 'preview'] as const

export type InterfaceMode = (typeof INTERFACE_MODES)[number]

/** One square of the layout grid, 0-based from the top-left. */
export interface InterfaceCell {
  row: number
  col: number
}

/**
 * The rectangle a module occupies: its top-left {@link InterfaceCell} plus how
 * many tracks it covers. Spans are always >= 1, so a `1x1` placement is a
 * plain cell — which is all the current authoring UI produces. Everything that
 * reads a placement handles spans, so enabling them is a UI change alone.
 */
export interface InterfacePlacement extends InterfaceCell {
  rowSpan: number
  colSpan: number
}

/**
 * The track counts a layout is authored against. Stored with the layout so an
 * interface keeps the shape it was built for even if the default changes.
 */
export interface InterfaceGrid {
  rows: number
  cols: number
}

export interface InterfaceOutputConfig {
  blockId: string
  path: string
}

export interface ChatModuleConfig {
  workflowId: string | null
  /** Same shape as chat-deployment outputConfigs; serialized `${blockId}_${path}` for selectedOutputs. */
  outputConfigs: InterfaceOutputConfig[]
  /** NEW, module-local — no chat-deployment counterpart. true = render streamed block chunks live; false = final outputs only. */
  showThinking: boolean
  welcomeMessage: string
}

export interface TableModuleConfig {
  tableId: string | null
}

export interface FileModuleConfig {
  fileId: string | null
}

/** @see INTERFACE_MODULE_TYPES — same single-source-of-truth rationale. */
export const FORM_FIELD_TYPES = ['short-text', 'long-text', 'dropdown', 'switch'] as const

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

export interface FormField {
  /** generateId(); stable across edits. Wire key for submitted values. */
  id: string
  /** /^[a-zA-Z_][a-zA-Z0-9_]*$/ — becomes the workflow start-block input key. Unique per form. */
  name: string
  label: string
  type: FormFieldType
  required: boolean
  placeholder?: string
  hint?: string
  /** dropdown only; required (≥1) when type === 'dropdown'. */
  options?: string[]
  defaultValue?: string | boolean
}

export interface FormModuleConfig {
  workflowId: string | null
  fields: FormField[]
  /** default 'Submit' */
  submitLabel: string
}

export interface InterfaceModuleBase {
  /** generateId(); stable across moves. */
  id: string
  placement: InterfacePlacement
}

export type InterfaceModule =
  | (InterfaceModuleBase & { type: 'chat'; config: ChatModuleConfig })
  | (InterfaceModuleBase & { type: 'table'; config: TableModuleConfig })
  | (InterfaceModuleBase & { type: 'file'; config: FileModuleConfig })
  | (InterfaceModuleBase & { type: 'form'; config: FormModuleConfig })

/**
 * The stored layout document.
 *
 * `version` is the migration seam: it is pinned to the single literal the
 * schema accepts, so reshaping the model later becomes a discriminated union
 * on this field rather than a guess about what an untagged blob means.
 */
export interface InterfaceLayout {
  version: 1
  grid: InterfaceGrid
  /** Unique ids; every placement fits `grid` and none of them overlap. */
  modules: InterfaceModule[]
}

export interface InterfaceDefinition {
  id: string
  workspaceId: string
  name: string
  description: string | null
  layout: InterfaceLayout
  createdBy: string
  createdAt: string // ISO
  updatedAt: string // ISO
  archivedAt: string | null
}
