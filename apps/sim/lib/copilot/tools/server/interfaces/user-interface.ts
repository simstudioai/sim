/**
 * Sim-side executor for the copilot `user_interface` tool.
 *
 * The Go definition lives at
 * `copilot/internal/tools/catalog/interfaces/user_interface.go` and is the
 * contract this file implements: an `{ operation, args }` envelope in, a
 * `{ success, message, data? }` envelope out. Every operation delegates to the
 * `@/lib/interfaces` service — the single persistence choke point — so layout
 * writes always pass through `validateLayout` and never touch the database
 * directly.
 */

import { AuditAction, type AuditActionType, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { UserInterface } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  type AddModuleData,
  addModule,
  type ChatModuleConfig,
  createInterface,
  deleteInterface,
  type FileModuleConfig,
  FORM_FIELD_TYPES,
  type FormField,
  type FormFieldType,
  type FormModuleConfig,
  getInterfaceById,
  INTERFACE_MODULE_TYPES,
  type InterfaceCell,
  InterfaceConflictError,
  type InterfaceDefinition,
  InterfaceLayoutError,
  type InterfaceModule,
  type InterfaceModuleType,
  type InterfaceOutputConfig,
  InvalidModuleReferenceError,
  listInterfaces,
  moveModule,
  removeModule,
  renameInterface,
  restoreInterface,
  type TableModuleConfig,
  updateInterfaceDescription,
  updateModuleConfig,
} from '@/lib/interfaces'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('UserInterfaceServerTool')

/**
 * Operations that mutate the workspace, gated by `WRITE_ACTIONS` in the router
 * and re-checked here against the caller's own workspace permission. `get` and
 * `list` are deliberately absent so read-only collaborators can still inspect
 * interfaces — they are still gated at `read`.
 */
export const USER_INTERFACE_WRITE_OPERATIONS = [
  'create',
  'rename',
  'set_description',
  'delete',
  'restore',
  'add_module',
  'update_module',
  'move_module',
  'remove_module',
] as const

const USER_INTERFACE_WRITE_OPERATION_SET = new Set<string>(USER_INTERFACE_WRITE_OPERATIONS)

function isWriteOperation(operation: string): boolean {
  return USER_INTERFACE_WRITE_OPERATION_SET.has(operation)
}

type ToolArgs = Record<string, unknown>

interface UserInterfaceArgs {
  operation: string
  args?: ToolArgs
}

interface UserInterfaceResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

/**
 * A caller-fixable problem: a missing or ill-typed argument, or an id that does
 * not resolve inside the caller's workspace. Its message reaches the model
 * verbatim as a soft `success: false` so the call can be corrected, rather than
 * through the generic `Operation failed:` wrapper reserved for real faults.
 */
class InterfaceToolInputError extends Error {}

const INTERFACE_MODULE_TYPE_SET = new Set<string>(INTERFACE_MODULE_TYPES)

const FORM_FIELD_TYPE_SET = new Set<string>(FORM_FIELD_TYPES)

function isRecord(value: unknown): value is ToolArgs {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCellIndex(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1
}

function isModuleType(value: unknown): value is InterfaceModuleType {
  return typeof value === 'string' && INTERFACE_MODULE_TYPE_SET.has(value)
}

function isFormFieldType(value: unknown): value is FormFieldType {
  return typeof value === 'string' && FORM_FIELD_TYPE_SET.has(value)
}

function optionalString(args: ToolArgs, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new InterfaceToolInputError(`${key} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function requiredString(args: ToolArgs, key: string, operation: string): string {
  const value = optionalString(args, key)
  if (!value) {
    throw new InterfaceToolInputError(`${key} is required for ${operation}`)
  }
  return value
}

function requiredCell(args: ToolArgs, operation: string): InterfaceCell {
  const value = args.cell
  if (!isRecord(value)) {
    throw new InterfaceToolInputError(
      `cell is required for ${operation} and must be { row: 0|1, col: 0|1 }`
    )
  }
  const { row, col } = value
  if (!isCellIndex(row) || !isCellIndex(col)) {
    throw new InterfaceToolInputError('cell.row and cell.col must each be 0 or 1')
  }
  return { row, col }
}

function requiredModuleType(args: ToolArgs, operation: string): InterfaceModuleType {
  const value = args.moduleType
  if (!isModuleType(value)) {
    throw new InterfaceToolInputError(
      `moduleType is required for ${operation} and must be one of: ${INTERFACE_MODULE_TYPES.join(', ')}`
    )
  }
  return value
}

function configRecord(raw: unknown): ToolArgs {
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) {
    throw new InterfaceToolInputError('config must be an object')
  }
  return raw
}

/** Reads a resource-reference field: absent, empty, or null all mean "unconfigured". */
function nullableId(config: ToolArgs, key: string): string | null {
  const value = config[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new InterfaceToolInputError(`config.${key} must be a string or null`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Reads a required-with-default config string. Blank and whitespace-only values
 * collapse to `fallback` — the subagent prompt instructs the model to send `""`
 * for an unset text field, and an empty `submitLabel` would persist a layout the
 * contract then refuses to accept back, bricking the editor's save path.
 */
function configString(config: ToolArgs, key: string, fallback: string): string {
  const value = config[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') {
    throw new InterfaceToolInputError(`config.${key} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function configBoolean(config: ToolArgs, key: string, fallback: boolean): boolean {
  const value = config[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') {
    throw new InterfaceToolInputError(`config.${key} must be a boolean`)
  }
  return value
}

function readOutputConfigs(config: ToolArgs): InterfaceOutputConfig[] {
  const value = config.outputConfigs
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new InterfaceToolInputError('config.outputConfigs must be an array of { blockId, path }')
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new InterfaceToolInputError(
        `config.outputConfigs[${index}] must be an object with blockId and path`
      )
    }
    const blockId = entry.blockId
    if (typeof blockId !== 'string' || blockId.trim().length === 0) {
      throw new InterfaceToolInputError(`config.outputConfigs[${index}].blockId is required`)
    }
    const path = entry.path
    if (path !== undefined && path !== null && typeof path !== 'string') {
      throw new InterfaceToolInputError(`config.outputConfigs[${index}].path must be a string`)
    }
    return { blockId: blockId.trim(), path: typeof path === 'string' ? path : '' }
  })
}

function readDropdownOptions(raw: unknown, index: number): string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) {
    throw new InterfaceToolInputError(`config.fields[${index}].options must be an array of strings`)
  }
  return raw.map((option) => {
    if (typeof option === 'string') return option
    if (typeof option === 'number') return String(option)
    throw new InterfaceToolInputError(`config.fields[${index}].options must contain only strings`)
  })
}

/**
 * Coerces one model-authored form field into a {@link FormField}. A missing
 * `id` is generated here (the Go tool documents `id` as optional for new
 * fields); name/label/option semantics stay with `validateLayout`.
 */
function readFormField(raw: unknown, index: number): FormField {
  if (!isRecord(raw)) {
    throw new InterfaceToolInputError(`config.fields[${index}] must be an object`)
  }

  const rawName = raw.name
  const name = typeof rawName === 'string' ? rawName.trim() : ''
  if (name.length === 0) {
    throw new InterfaceToolInputError(`config.fields[${index}].name is required`)
  }

  const type = raw.type
  if (!isFormFieldType(type)) {
    throw new InterfaceToolInputError(
      `config.fields[${index}].type must be one of: ${FORM_FIELD_TYPES.join(', ')}`
    )
  }

  const rawId = raw.id
  const rawLabel = raw.label
  const field: FormField = {
    id: typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : generateId(),
    name,
    label: typeof rawLabel === 'string' && rawLabel.trim().length > 0 ? rawLabel : name,
    type,
    required: raw.required === true,
  }

  if (typeof raw.placeholder === 'string') field.placeholder = raw.placeholder
  if (typeof raw.hint === 'string') field.hint = raw.hint

  if (type === 'dropdown') {
    const options = readDropdownOptions(raw.options, index)
    if (options) field.options = options
  }

  const defaultValue = raw.defaultValue
  if (defaultValue !== undefined && defaultValue !== null) {
    if (typeof defaultValue !== 'string' && typeof defaultValue !== 'boolean') {
      throw new InterfaceToolInputError(
        `config.fields[${index}].defaultValue must be a string or boolean`
      )
    }
    field.defaultValue = defaultValue
  }

  return field
}

/**
 * Coerces a model-authored config into the module type's domain shape. Absent
 * fields fall back to the type's empty defaults (the same values
 * `DEFAULT_MODULE_CONFIGS` applies); ill-typed fields are rejected up front so
 * the model gets a pointed message instead of a layout-validation dump. All
 * semantic rules — bounds, name patterns, same-workspace ownership — remain
 * with `validateLayout`.
 */
function normalizeChatConfig(raw: unknown): ChatModuleConfig {
  const config = configRecord(raw)
  return {
    workflowId: nullableId(config, 'workflowId'),
    outputConfigs: readOutputConfigs(config),
    showThinking: configBoolean(config, 'showThinking', false),
    welcomeMessage: configString(config, 'welcomeMessage', ''),
  }
}

function normalizeTableConfig(raw: unknown): TableModuleConfig {
  return { tableId: nullableId(configRecord(raw), 'tableId') }
}

function normalizeFileConfig(raw: unknown): FileModuleConfig {
  return { fileId: nullableId(configRecord(raw), 'fileId') }
}

function normalizeFormConfig(raw: unknown): FormModuleConfig {
  const config = configRecord(raw)
  const fields = config.fields
  if (fields !== undefined && fields !== null && !Array.isArray(fields)) {
    throw new InterfaceToolInputError('config.fields must be an array')
  }
  return {
    workflowId: nullableId(config, 'workflowId'),
    submitLabel: configString(config, 'submitLabel', 'Submit'),
    fields: Array.isArray(fields) ? fields.map(readFormField) : [],
  }
}

function normalizeModuleConfig(type: InterfaceModuleType, raw: unknown): InterfaceModule['config'] {
  switch (type) {
    case 'chat':
      return normalizeChatConfig(raw)
    case 'table':
      return normalizeTableConfig(raw)
    case 'file':
      return normalizeFileConfig(raw)
    case 'form':
      return normalizeFormConfig(raw)
  }
}

/**
 * Builds the service payload for `add_module`. An absent config is forwarded as
 * `undefined` so the service applies the type's documented defaults.
 */
function buildAddModuleData(
  type: InterfaceModuleType,
  cell: InterfaceCell,
  raw: unknown
): AddModuleData {
  const hasConfig = raw !== undefined && raw !== null
  switch (type) {
    case 'chat':
      return { type, cell, config: hasConfig ? normalizeChatConfig(raw) : undefined }
    case 'table':
      return { type, cell, config: hasConfig ? normalizeTableConfig(raw) : undefined }
    case 'file':
      return { type, cell, config: hasConfig ? normalizeFileConfig(raw) : undefined }
    case 'form':
      return { type, cell, config: hasConfig ? normalizeFormConfig(raw) : undefined }
  }
}

interface SerializedInterface {
  id: string
  name: string
  description: string | null
  modules: InterfaceModule[]
  createdAt: string
  updatedAt: string
}

interface SerializedInterfaceSummary {
  id: string
  name: string
  description: string | null
  moduleCount: number
  createdAt: string
  updatedAt: string
}

function serializeInterface(definition: InterfaceDefinition): SerializedInterface {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    modules: definition.layout.modules,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  }
}

function serializeInterfaceSummary(definition: InterfaceDefinition): SerializedInterfaceSummary {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    moduleCount: definition.layout.modules.length,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  }
}

/**
 * Loads an interface and asserts it belongs to the caller's workspace. A
 * cross-workspace id is reported as "not found" so the tool can never be used
 * to probe another workspace's interfaces.
 */
async function requireInterfaceInWorkspace(
  interfaceId: string,
  workspaceId: string,
  options?: { includeArchived?: boolean }
): Promise<InterfaceDefinition> {
  const definition = await getInterfaceById(interfaceId, options)
  if (!definition || definition.workspaceId !== workspaceId) {
    throw new InterfaceToolInputError(
      `Interface not found: ${interfaceId}. Discover interfaces with glob("interfaces/*/meta.json") and use the id from meta.json.`
    )
  }
  return definition
}

function requireModule(definition: InterfaceDefinition, moduleId: string): InterfaceModule {
  const module = definition.layout.modules.find((entry) => entry.id === moduleId)
  if (!module) {
    const available = definition.layout.modules
      .map((entry) => `${entry.id} (${entry.type})`)
      .join(', ')
    throw new InterfaceToolInputError(
      `Module not found: ${moduleId}. Interface "${definition.name}" has ${available || 'no modules'}.`
    )
  }
  return module
}

function auditInterface(params: {
  workspaceId: string
  actorId: string
  action: AuditActionType
  interfaceId: string
  interfaceName: string
  description: string
}): void {
  recordAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    action: params.action,
    resourceType: AuditResourceType.INTERFACE,
    resourceId: params.interfaceId,
    resourceName: params.interfaceName,
    description: params.description,
    metadata: { source: 'tool_input' },
  })
}

function describeCell(cell: InterfaceCell): string {
  return `(${cell.row}, ${cell.col})`
}

export const userInterfaceServerTool: BaseServerTool<UserInterfaceArgs, UserInterfaceResult> = {
  name: UserInterface.id,
  async execute(
    params: UserInterfaceArgs,
    context?: ServerToolContext
  ): Promise<UserInterfaceResult> {
    if (!context?.userId) {
      logger.error('Unauthorized attempt to manage interfaces - no authenticated user context')
      throw new Error('Authentication required')
    }

    const { operation, args = {} } = params
    const actorId = context.userId
    const assertNotAborted = () =>
      assertServerToolNotAborted(
        context,
        'Request aborted before interface mutation could be applied.'
      )

    try {
      const workspaceId = context.workspaceId
      if (!workspaceId) {
        return { success: false, message: 'Workspace ID is required' }
      }

      const level = isWriteOperation(operation) ? 'write' : 'read'
      const permission = await getUserEntityPermissions(actorId, 'workspace', workspaceId)
      if (!permissionSatisfies(permission, level)) {
        logger.warn('Access denied to interfaces', { workspaceId, actorId, operation })
        return {
          success: false,
          message: `Permission denied: '${operation}' requires ${level} access to this workspace.`,
        }
      }

      switch (operation) {
        case 'create': {
          const name = requiredString(args, 'name', 'create')
          const description = optionalString(args, 'description') ?? null

          assertNotAborted()
          const definition = await createInterface({
            workspaceId,
            name,
            description,
            createdBy: actorId,
          })

          auditInterface({
            workspaceId,
            actorId,
            action: AuditAction.INTERFACE_CREATED,
            interfaceId: definition.id,
            interfaceName: definition.name,
            description: `Created interface "${definition.name}"`,
          })

          return {
            success: true,
            message: `Created interface "${definition.name}" (${definition.id}). Add modules with add_module.`,
            data: { interface: serializeInterface(definition) },
          }
        }

        case 'get': {
          const interfaceId = requiredString(args, 'interfaceId', 'get')
          const definition = await requireInterfaceInWorkspace(interfaceId, workspaceId)
          const moduleCount = definition.layout.modules.length

          return {
            success: true,
            message: `Interface "${definition.name}" has ${moduleCount} module(s)`,
            data: { interface: serializeInterface(definition) },
          }
        }

        case 'list': {
          const definitions = await listInterfaces(workspaceId)

          return {
            success: true,
            message:
              definitions.length === 0
                ? 'No interfaces in this workspace yet'
                : `Found ${definitions.length} interface(s)`,
            data: {
              count: definitions.length,
              interfaces: definitions.map(serializeInterfaceSummary),
            },
          }
        }

        case 'rename': {
          const interfaceId = requiredString(args, 'interfaceId', 'rename')
          const name = requiredString(args, 'name', 'rename')
          const existing = await requireInterfaceInWorkspace(interfaceId, workspaceId)

          assertNotAborted()
          const definition = await renameInterface(interfaceId, name)

          auditInterface({
            workspaceId,
            actorId,
            action: AuditAction.INTERFACE_UPDATED,
            interfaceId: definition.id,
            interfaceName: definition.name,
            description: `Renamed interface "${existing.name}" to "${definition.name}"`,
          })

          return {
            success: true,
            message: `Renamed interface to "${definition.name}"`,
            data: { interface: serializeInterface(definition) },
          }
        }

        case 'set_description': {
          const interfaceId = requiredString(args, 'interfaceId', 'set_description')
          const raw = args.description
          if (raw === undefined) {
            throw new InterfaceToolInputError('description is required for set_description')
          }
          if (raw !== null && typeof raw !== 'string') {
            throw new InterfaceToolInputError('description must be a string or null')
          }
          const description = raw === null || raw.trim().length === 0 ? null : raw

          await requireInterfaceInWorkspace(interfaceId, workspaceId)

          assertNotAborted()
          const definition = await updateInterfaceDescription(interfaceId, description)
          const outcome = `${description ? 'Updated' : 'Cleared'} description of interface "${definition.name}"`

          auditInterface({
            workspaceId,
            actorId,
            action: AuditAction.INTERFACE_UPDATED,
            interfaceId: definition.id,
            interfaceName: definition.name,
            description: outcome,
          })

          return {
            success: true,
            message: outcome,
            data: { interface: serializeInterface(definition) },
          }
        }

        case 'delete': {
          const interfaceId = requiredString(args, 'interfaceId', 'delete')
          const definition = await requireInterfaceInWorkspace(interfaceId, workspaceId)

          assertNotAborted()
          await deleteInterface(interfaceId)

          auditInterface({
            workspaceId,
            actorId,
            action: AuditAction.INTERFACE_DELETED,
            interfaceId: definition.id,
            interfaceName: definition.name,
            description: `Archived interface "${definition.name}"`,
          })

          return {
            success: true,
            message: `Archived interface "${definition.name}". Use restore to bring it back.`,
            data: { interfaceId: definition.id, name: definition.name },
          }
        }

        case 'restore': {
          const interfaceId = requiredString(args, 'interfaceId', 'restore')
          const archived = await requireInterfaceInWorkspace(interfaceId, workspaceId, {
            includeArchived: true,
          })
          if (!archived.archivedAt) {
            return {
              success: false,
              message: `Interface "${archived.name}" is not archived`,
            }
          }

          assertNotAborted()
          const definition = await restoreInterface(interfaceId)

          auditInterface({
            workspaceId,
            actorId,
            action: AuditAction.INTERFACE_RESTORED,
            interfaceId: definition.id,
            interfaceName: definition.name,
            description: `Restored interface "${definition.name}"`,
          })

          return {
            success: true,
            message:
              definition.name === archived.name
                ? `Restored interface "${definition.name}"`
                : `Restored interface as "${definition.name}" (the original name was taken)`,
            data: { interface: serializeInterface(definition) },
          }
        }

        case 'add_module': {
          const interfaceId = requiredString(args, 'interfaceId', 'add_module')
          const moduleType = requiredModuleType(args, 'add_module')
          const cell = requiredCell(args, 'add_module')
          const existing = await requireInterfaceInWorkspace(interfaceId, workspaceId)
          const data = buildAddModuleData(moduleType, cell, args.config)

          assertNotAborted()
          const { definition, moduleId } = await addModule(existing.id, data)

          auditInterface({
            workspaceId,
            actorId,
            action: AuditAction.INTERFACE_UPDATED,
            interfaceId: definition.id,
            interfaceName: definition.name,
            description: `Added ${moduleType} module to interface "${definition.name}"`,
          })

          return {
            success: true,
            message: `Added ${moduleType} module ${moduleId} at cell ${describeCell(cell)} on "${definition.name}"`,
            data: { moduleId, interface: serializeInterface(definition) },
          }
        }

        case 'update_module': {
          const interfaceId = requiredString(args, 'interfaceId', 'update_module')
          const moduleId = requiredString(args, 'moduleId', 'update_module')
          if (args.config === undefined || args.config === null) {
            throw new InterfaceToolInputError(
              'config is required for update_module — send the complete config for the module type'
            )
          }
          const existing = await requireInterfaceInWorkspace(interfaceId, workspaceId)
          const module = requireModule(existing, moduleId)
          const config = normalizeModuleConfig(module.type, args.config)

          assertNotAborted()
          const definition = await updateModuleConfig(existing.id, moduleId, config)

          auditInterface({
            workspaceId,
            actorId,
            action: AuditAction.INTERFACE_UPDATED,
            interfaceId: definition.id,
            interfaceName: definition.name,
            description: `Updated ${module.type} module on interface "${definition.name}"`,
          })

          return {
            success: true,
            message: `Updated ${module.type} module ${moduleId} on "${definition.name}"`,
            data: { moduleId, interface: serializeInterface(definition) },
          }
        }

        case 'move_module': {
          const interfaceId = requiredString(args, 'interfaceId', 'move_module')
          const moduleId = requiredString(args, 'moduleId', 'move_module')
          const cell = requiredCell(args, 'move_module')
          const existing = await requireInterfaceInWorkspace(interfaceId, workspaceId)
          const module = requireModule(existing, moduleId)
          const displaced = existing.layout.modules.find(
            (entry) =>
              entry.id !== moduleId && entry.cell.row === cell.row && entry.cell.col === cell.col
          )

          assertNotAborted()
          const definition = await moveModule(existing.id, moduleId, cell)

          auditInterface({
            workspaceId,
            actorId,
            action: AuditAction.INTERFACE_UPDATED,
            interfaceId: definition.id,
            interfaceName: definition.name,
            description: `Moved a ${module.type} module on interface "${definition.name}"`,
          })

          return {
            success: true,
            message: displaced
              ? `Moved module ${moduleId} to cell ${describeCell(cell)} on "${definition.name}", swapping with module ${displaced.id}`
              : `Moved module ${moduleId} to cell ${describeCell(cell)} on "${definition.name}"`,
            data: { moduleId, interface: serializeInterface(definition) },
          }
        }

        case 'remove_module': {
          const interfaceId = requiredString(args, 'interfaceId', 'remove_module')
          const moduleId = requiredString(args, 'moduleId', 'remove_module')
          const existing = await requireInterfaceInWorkspace(interfaceId, workspaceId)
          const module = requireModule(existing, moduleId)

          assertNotAborted()
          const definition = await removeModule(existing.id, moduleId)

          auditInterface({
            workspaceId,
            actorId,
            action: AuditAction.INTERFACE_UPDATED,
            interfaceId: definition.id,
            interfaceName: definition.name,
            description: `Removed a ${module.type} module from interface "${definition.name}"`,
          })

          return {
            success: true,
            message: `Removed ${module.type} module ${moduleId} from "${definition.name}"`,
            data: { moduleId, interface: serializeInterface(definition) },
          }
        }

        default:
          return { success: false, message: `Unknown operation: ${operation}` }
      }
    } catch (error) {
      if (
        error instanceof InterfaceToolInputError ||
        error instanceof InterfaceLayoutError ||
        error instanceof InvalidModuleReferenceError ||
        error instanceof InterfaceConflictError
      ) {
        logger.warn('Interface operation rejected', { operation, error: error.message })
        return { success: false, message: error.message }
      }

      const errorMessage = toError(error).message
      const cause = error instanceof Error && error.cause ? toError(error.cause).message : undefined
      logger.error('Interface operation failed', { operation, error: errorMessage, cause })
      const displayMessage = cause ? `${errorMessage} (${cause})` : errorMessage
      return { success: false, message: `Operation failed: ${displayMessage}` }
    }
  },
}
