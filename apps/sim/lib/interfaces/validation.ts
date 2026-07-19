/**
 * Layout validation for workspace interfaces.
 *
 * `validateLayout` is the single semantic gate for every layout write — the
 * API routes, the copilot `user_interface` tool, and the granular service
 * module operations all pass through it. It enforces the structural
 * invariants (module count, unique ids/cells, form-field rules, bounds) and
 * asserts that every non-null resource reference resolves to an entity in the
 * SAME workspace (confused-deputy defense). Null references are allowed at
 * rest (unconfigured modules); dangling references are tolerated at read time
 * — renderers show a missing-resource state.
 *
 * Reference checking is **differential**: callers pass the layout being
 * replaced as `previous`, and any reference already present there is
 * grandfathered in. Without this, archiving a single referenced table would
 * make every later write to the interface fail — an interface that renders a
 * missing-resource state but can never be edited again. Grandfathering is
 * safe because a carried-over reference was already proven to belong to this
 * workspace when it was introduced, and an interface never changes workspace;
 * every new or changed reference is still checked in full.
 *
 * Every reference check runs on the caller-supplied `executor`. `mutateLayout`
 * validates while holding a row lock, so the checks must join that transaction
 * rather than reach for the global pool — a second checkout held open by the
 * transaction's own connection deadlocks the pool at saturation, and the
 * `db.transaction` tripwire rejects it outright outside production.
 */

import { db } from '@sim/db'
import { workflow, workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  FORM_FIELD_NAME_PATTERN,
  INTERFACE_LAYOUT_LIMITS,
  isReservedFormFieldName,
  RESERVED_FORM_FIELD_NAMES,
} from '@/lib/interfaces/constants'
import {
  FORM_FIELD_TYPES,
  type FormField,
  type InterfaceLayout,
  type InterfaceModule,
} from '@/lib/interfaces/types'
import { getTableById } from '@/lib/table'

/** Structural layout invariant violation — maps to HTTP 400. */
export class InterfaceLayoutError extends Error {
  readonly code = 'INVALID_INTERFACE_LAYOUT' as const
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('; '))
    this.errors = errors
  }
}

export type InterfaceModuleReferenceType = 'workflow' | 'table' | 'file'

/** A module references a resource that does not exist in the interface's workspace — maps to HTTP 400. */
export class InvalidModuleReferenceError extends Error {
  readonly code = 'INVALID_MODULE_REFERENCE' as const
  readonly moduleId: string
  readonly refType: InterfaceModuleReferenceType
  readonly refId: string

  constructor(moduleId: string, refType: InterfaceModuleReferenceType, refId: string) {
    super(
      `${refType === 'workflow' ? 'Workflow' : refType === 'table' ? 'Table' : 'File'} "${refId}" referenced by module "${moduleId}" was not found in this workspace`
    )
    this.moduleId = moduleId
    this.refType = refType
    this.refId = refId
  }
}

const FORM_FIELD_TYPE_SET = new Set<string>(FORM_FIELD_TYPES)

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function collectFormFieldErrors(moduleId: string, fields: FormField[], errors: string[]): void {
  if (fields.length > INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS) {
    errors.push(
      `Module "${moduleId}": a form can have at most ${INTERFACE_LAYOUT_LIMITS.MAX_FORM_FIELDS} fields`
    )
  }

  const seenIds = new Set<string>()
  const seenNames = new Set<string>()

  for (const field of fields) {
    if (typeof field.id !== 'string' || field.id.length === 0) {
      errors.push(`Module "${moduleId}": every form field needs a non-empty id`)
      continue
    }
    if (field.id.length > INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH) {
      errors.push(
        `Module "${moduleId}": form field id "${field.id}" exceeds ${INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH} characters`
      )
    }
    if (seenIds.has(field.id)) {
      errors.push(`Module "${moduleId}": duplicate form field id "${field.id}"`)
    }
    seenIds.add(field.id)

    const name = typeof field.name === 'string' ? field.name : ''
    if (name.length === 0 || !FORM_FIELD_NAME_PATTERN.test(name)) {
      errors.push(
        `Module "${moduleId}": field name "${name}" must start with a letter or underscore and contain only alphanumeric characters and underscores`
      )
    } else {
      if (name.length > INTERFACE_LAYOUT_LIMITS.MAX_FIELD_NAME_LENGTH) {
        errors.push(
          `Module "${moduleId}": field name "${name}" exceeds ${INTERFACE_LAYOUT_LIMITS.MAX_FIELD_NAME_LENGTH} characters`
        )
      }
      if (isReservedFormFieldName(name)) {
        errors.push(
          `Module "${moduleId}": field name "${name}" is reserved. Reserved names are: ${RESERVED_FORM_FIELD_NAMES.join(', ')}`
        )
      }
      const lowered = name.toLowerCase()
      if (seenNames.has(lowered)) {
        errors.push(`Module "${moduleId}": duplicate form field name "${name}"`)
      }
      seenNames.add(lowered)
    }

    if (typeof field.label !== 'string') {
      errors.push(`Module "${moduleId}": field "${name}" label must be a string`)
    } else if (field.label.length > INTERFACE_LAYOUT_LIMITS.MAX_FIELD_LABEL_LENGTH) {
      errors.push(
        `Module "${moduleId}": field "${name}" label exceeds ${INTERFACE_LAYOUT_LIMITS.MAX_FIELD_LABEL_LENGTH} characters`
      )
    }

    if (
      field.placeholder !== undefined &&
      (typeof field.placeholder !== 'string' ||
        field.placeholder.length > INTERFACE_LAYOUT_LIMITS.MAX_PLACEHOLDER_LENGTH)
    ) {
      errors.push(
        `Module "${moduleId}": field "${name}" placeholder exceeds ${INTERFACE_LAYOUT_LIMITS.MAX_PLACEHOLDER_LENGTH} characters`
      )
    }

    if (
      field.hint !== undefined &&
      (typeof field.hint !== 'string' ||
        field.hint.length > INTERFACE_LAYOUT_LIMITS.MAX_HINT_LENGTH)
    ) {
      errors.push(
        `Module "${moduleId}": field "${name}" hint exceeds ${INTERFACE_LAYOUT_LIMITS.MAX_HINT_LENGTH} characters`
      )
    }

    if (field.defaultValue !== undefined) {
      if (typeof field.defaultValue === 'string') {
        if (field.defaultValue.length > INTERFACE_LAYOUT_LIMITS.MAX_DEFAULT_VALUE_LENGTH) {
          errors.push(
            `Module "${moduleId}": field "${name}" default value exceeds ${INTERFACE_LAYOUT_LIMITS.MAX_DEFAULT_VALUE_LENGTH} characters`
          )
        }
      } else if (typeof field.defaultValue !== 'boolean') {
        errors.push(
          `Module "${moduleId}": field "${name}" default value must be a string or a boolean`
        )
      }
    }

    if (field.type === 'dropdown') {
      const options = field.options
      if (!Array.isArray(options) || options.length === 0) {
        errors.push(`Module "${moduleId}": dropdown field "${name}" needs at least one option`)
      } else {
        if (options.length > INTERFACE_LAYOUT_LIMITS.MAX_OPTIONS) {
          errors.push(
            `Module "${moduleId}": dropdown field "${name}" can have at most ${INTERFACE_LAYOUT_LIMITS.MAX_OPTIONS} options`
          )
        }
        for (const option of options) {
          if (
            typeof option !== 'string' ||
            option.length === 0 ||
            option.length > INTERFACE_LAYOUT_LIMITS.MAX_OPTION_LENGTH
          ) {
            errors.push(
              `Module "${moduleId}": dropdown field "${name}" options must be non-empty strings of at most ${INTERFACE_LAYOUT_LIMITS.MAX_OPTION_LENGTH} characters`
            )
            break
          }
        }
      }
    } else if (!FORM_FIELD_TYPE_SET.has(field.type)) {
      errors.push(`Module "${moduleId}": field "${name}" has unknown type "${field.type}"`)
    }
  }
}

function collectModuleConfigErrors(module: InterfaceModule, errors: string[]): void {
  switch (module.type) {
    case 'chat': {
      const config = module.config
      if (!isNullableString(config.workflowId)) {
        errors.push(`Module "${module.id}": chat workflowId must be a string or null`)
      }
      if (!Array.isArray(config.outputConfigs)) {
        errors.push(`Module "${module.id}": chat outputConfigs must be an array`)
      } else {
        if (config.outputConfigs.length > INTERFACE_LAYOUT_LIMITS.MAX_OUTPUT_CONFIGS) {
          errors.push(
            `Module "${module.id}": chat can select at most ${INTERFACE_LAYOUT_LIMITS.MAX_OUTPUT_CONFIGS} outputs`
          )
        }
        for (const output of config.outputConfigs) {
          if (typeof output?.blockId !== 'string' || output.blockId.length === 0) {
            errors.push(`Module "${module.id}": every chat output needs a non-empty blockId`)
            break
          }
          if (
            typeof output.path !== 'string' ||
            output.path.length > INTERFACE_LAYOUT_LIMITS.MAX_OUTPUT_PATH_LENGTH
          ) {
            errors.push(
              `Module "${module.id}": chat output paths must be strings of at most ${INTERFACE_LAYOUT_LIMITS.MAX_OUTPUT_PATH_LENGTH} characters`
            )
            break
          }
        }
      }
      if (typeof config.showThinking !== 'boolean') {
        errors.push(`Module "${module.id}": chat showThinking must be a boolean`)
      }
      if (
        typeof config.welcomeMessage !== 'string' ||
        config.welcomeMessage.length > INTERFACE_LAYOUT_LIMITS.MAX_WELCOME_MESSAGE_LENGTH
      ) {
        errors.push(
          `Module "${module.id}": chat welcome message exceeds ${INTERFACE_LAYOUT_LIMITS.MAX_WELCOME_MESSAGE_LENGTH} characters`
        )
      }
      break
    }
    case 'table': {
      if (!isNullableString(module.config.tableId)) {
        errors.push(`Module "${module.id}": table tableId must be a string or null`)
      }
      break
    }
    case 'file': {
      if (!isNullableString(module.config.fileId)) {
        errors.push(`Module "${module.id}": file fileId must be a string or null`)
      }
      break
    }
    case 'form': {
      const config = module.config
      if (!isNullableString(config.workflowId)) {
        errors.push(`Module "${module.id}": form workflowId must be a string or null`)
      }
      if (typeof config.submitLabel !== 'string') {
        errors.push(`Module "${module.id}": form submitLabel must be a string`)
      } else if (config.submitLabel.trim().length === 0) {
        errors.push(`Module "${module.id}": form submit label is required`)
      } else if (config.submitLabel.length > INTERFACE_LAYOUT_LIMITS.MAX_SUBMIT_LABEL_LENGTH) {
        errors.push(
          `Module "${module.id}": form submit label exceeds ${INTERFACE_LAYOUT_LIMITS.MAX_SUBMIT_LABEL_LENGTH} characters`
        )
      }
      if (!Array.isArray(config.fields)) {
        errors.push(`Module "${module.id}": form fields must be an array`)
      } else {
        collectFormFieldErrors(module.id, config.fields, errors)
      }
      break
    }
    default: {
      errors.push(`Unknown module type "${(module as InterfaceModule).type}"`)
    }
  }
}

/**
 * Collects every structural invariant violation in `layout`. Pure and
 * synchronous — resource references are checked separately by
 * {@link validateLayout}.
 */
export function collectLayoutErrors(layout: InterfaceLayout): string[] {
  const errors: string[] = []

  if (layout.version !== 1) {
    errors.push('Unsupported layout version')
    return errors
  }
  if (!Array.isArray(layout.modules)) {
    errors.push('Layout modules must be an array')
    return errors
  }
  if (layout.modules.length > INTERFACE_LAYOUT_LIMITS.MAX_MODULES) {
    errors.push(`An interface can have at most ${INTERFACE_LAYOUT_LIMITS.MAX_MODULES} modules`)
  }

  const seenIds = new Set<string>()
  const seenCells = new Set<string>()

  for (const module of layout.modules) {
    if (typeof module.id !== 'string' || module.id.length === 0) {
      errors.push('Every module needs a non-empty id')
      continue
    }
    if (module.id.length > INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH) {
      errors.push(
        `Module "${module.id}": id exceeds ${INTERFACE_LAYOUT_LIMITS.MAX_ID_LENGTH} characters`
      )
    }
    if (seenIds.has(module.id)) {
      errors.push(`Duplicate module id "${module.id}"`)
    }
    seenIds.add(module.id)

    const { row, col } = module.cell ?? {}
    if ((row !== 0 && row !== 1) || (col !== 0 && col !== 1)) {
      errors.push(`Module "${module.id}": cell row and col must each be 0 or 1`)
    } else {
      const cellKey = `${row},${col}`
      if (seenCells.has(cellKey)) {
        errors.push(`Module "${module.id}": cell (${row}, ${col}) is already occupied`)
      }
      seenCells.add(cellKey)
    }

    collectModuleConfigErrors(module, errors)
  }

  return errors
}

async function assertWorkflowInWorkspace(
  workspaceId: string,
  moduleId: string,
  workflowId: string,
  executor: DbOrTx
): Promise<void> {
  const rows = await executor
    .select({ id: workflow.id, workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
    .limit(1)
  if (rows.length === 0 || rows[0].workspaceId !== workspaceId) {
    throw new InvalidModuleReferenceError(moduleId, 'workflow', workflowId)
  }
}

async function assertTableInWorkspace(
  workspaceId: string,
  moduleId: string,
  tableId: string,
  executor: DbOrTx
): Promise<void> {
  const table = await getTableById(tableId, { tx: executor })
  if (!table || table.workspaceId !== workspaceId) {
    throw new InvalidModuleReferenceError(moduleId, 'table', tableId)
  }
}

/**
 * Queried inline rather than through `getWorkspaceFile`, which is pinned to the
 * global `db` handle and so cannot join the caller's transaction. It also
 * collapses every failure into `null`, which would report an infrastructure
 * error as a missing reference — a file that plainly exists rejected with
 * "was not found in this workspace".
 */
async function assertFileInWorkspace(
  workspaceId: string,
  moduleId: string,
  fileId: string,
  executor: DbOrTx
): Promise<void> {
  const rows = await executor
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)
  if (rows.length === 0) {
    throw new InvalidModuleReferenceError(moduleId, 'file', fileId)
  }
}

interface ModuleReference {
  type: InterfaceModuleReferenceType
  id: string
}

/** The single resource a module points at, or null when it is unconfigured. */
function moduleReference(module: InterfaceModule): ModuleReference | null {
  switch (module.type) {
    case 'chat':
    case 'form':
      return module.config.workflowId === null
        ? null
        : { type: 'workflow', id: module.config.workflowId }
    case 'table':
      return module.config.tableId === null ? null : { type: 'table', id: module.config.tableId }
    case 'file':
      return module.config.fileId === null ? null : { type: 'file', id: module.config.fileId }
  }
}

function referenceKey(ref: ModuleReference): string {
  return `${ref.type}:${ref.id}`
}

/** Reference keys already persisted in `layout` — these are grandfathered in. */
function collectReferenceKeys(layout: InterfaceLayout | undefined): Set<string> {
  const keys = new Set<string>()
  if (!layout || !Array.isArray(layout.modules)) return keys
  for (const module of layout.modules) {
    const ref = moduleReference(module)
    if (ref) keys.add(referenceKey(ref))
  }
  return keys
}

/**
 * Validates a full interface layout before it is persisted.
 *
 * @param previous the layout being replaced. References it already contains
 * are not re-checked, so an interface whose table/file/workflow was archived
 * stays editable. Omit it to check every reference (creation, or any write
 * with no known prior state).
 * @param executor the transaction to run the reference checks on. Callers
 * validating inside a transaction MUST pass their `tx` handle; defaults to the
 * global pool for the standalone pre-flight case.
 * @throws {InterfaceLayoutError} when a structural invariant is violated
 * @throws {InvalidModuleReferenceError} when a new or changed workflow/table/
 * file reference does not resolve to an entity in `workspaceId`
 */
export async function validateLayout(
  workspaceId: string,
  layout: InterfaceLayout,
  previous?: InterfaceLayout,
  executor: DbOrTx = db
): Promise<void> {
  const errors = collectLayoutErrors(layout)
  if (errors.length > 0) {
    throw new InterfaceLayoutError(errors)
  }

  const grandfathered = collectReferenceKeys(previous)

  /**
   * Checked one at a time rather than through `Promise.all`: `executor` is
   * usually a transaction handle with a single reserved connection, and the
   * count is bounded by {@link INTERFACE_LAYOUT_LIMITS.MAX_MODULES} — zero on
   * the layout-only autosave path that dominates traffic. Sequential also
   * fails fast on the first bad reference and makes which one is reported
   * deterministic rather than a race.
   */
  for (const module of layout.modules) {
    const ref = moduleReference(module)
    if (!ref || grandfathered.has(referenceKey(ref))) continue

    switch (ref.type) {
      case 'workflow':
        await assertWorkflowInWorkspace(workspaceId, module.id, ref.id, executor)
        break
      case 'table':
        await assertTableInWorkspace(workspaceId, module.id, ref.id, executor)
        break
      case 'file':
        await assertFileInWorkspace(workspaceId, module.id, ref.id, executor)
        break
    }
  }
}
