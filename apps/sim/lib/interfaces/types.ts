/**
 * Domain model for workspace interfaces — 2x2 grid pages composed of chat,
 * table, file, and form modules wired to workspace resources.
 *
 * This file is the source of truth for the interface wire shapes. The HTTP
 * contracts (`@/lib/api/contracts/interfaces`), the service layer, and the
 * copilot tool all pin to these types.
 */

/**
 * Every module type, in no particular order. Runtime guards, the contract
 * enum, and the copilot tool all derive from this tuple so widening the union
 * is a single edit that cannot silently miss a validator.
 */
export const INTERFACE_MODULE_TYPES = ['chat', 'table', 'file', 'form'] as const

export type InterfaceModuleType = (typeof INTERFACE_MODULE_TYPES)[number]

export interface InterfaceCell {
  row: 0 | 1
  col: 0 | 1
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
  cell: InterfaceCell
}

export type InterfaceModule =
  | (InterfaceModuleBase & { type: 'chat'; config: ChatModuleConfig })
  | (InterfaceModuleBase & { type: 'table'; config: TableModuleConfig })
  | (InterfaceModuleBase & { type: 'file'; config: FileModuleConfig })
  | (InterfaceModuleBase & { type: 'form'; config: FormModuleConfig })

export interface InterfaceLayout {
  version: 1
  modules: InterfaceModule[] // ≤ 4, unique ids, unique cells
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
