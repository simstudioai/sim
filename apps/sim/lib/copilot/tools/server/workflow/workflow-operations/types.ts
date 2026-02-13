import { createLogger } from '@sim/logger'
import type { PermissionGroupConfig } from '@/lib/permission-groups/types'

/** Selector subblock types that can be validated */
export const SELECTOR_TYPES = new Set([
  'oauth-input',
  'knowledge-base-selector',
  'document-selector',
  'file-selector',
  'project-selector',
  'channel-selector',
  'folder-selector',
  'mcp-server-selector',
  'mcp-tool-selector',
  'workflow-selector',
])

const validationLogger = createLogger('EditWorkflowValidation')

/** UUID v4 regex pattern for validation */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validation error for a specific field
 */
export interface ValidationError {
  blockId: string
  blockType: string
  field: string
  value: any
  error: string
}

/**
 * Types of items that can be skipped during operation application
 */
export type SkippedItemType =
  | 'block_not_found'
  | 'invalid_block_type'
  | 'block_not_allowed'
  | 'block_locked'
  | 'tool_not_allowed'
  | 'invalid_edge_target'
  | 'invalid_edge_source'
  | 'invalid_source_handle'
  | 'invalid_target_handle'
  | 'invalid_subflow_boundary_edge'
  | 'invalid_subblock_field'
  | 'missing_required_params'
  | 'invalid_subflow_parent'
  | 'nested_subflow_not_allowed'
  | 'duplicate_block_name'
  | 'reserved_block_name'
  | 'duplicate_trigger'
  | 'duplicate_single_instance_block'

/**
 * Represents an item that was skipped during operation application
 */
export interface SkippedItem {
  type: SkippedItemType
  operationType: string
  blockId: string
  reason: string
  details?: Record<string, any>
}

/**
 * Logs and records a skipped item
 */
export function logSkippedItem(skippedItems: SkippedItem[], item: SkippedItem): void {
  validationLogger.warn(`Skipped ${item.operationType} operation: ${item.reason}`, {
    type: item.type,
    operationType: item.operationType,
    blockId: item.blockId,
    ...(item.details && { details: item.details }),
  })
  skippedItems.push(item)
}

/**
 * Result of input validation
 */
export interface ValidationResult {
  validInputs: Record<string, any>
  errors: ValidationError[]
}

/**
 * Result of validating a single value
 */
export interface ValueValidationResult {
  valid: boolean
  value?: any
  error?: ValidationError
}

export interface EditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete' | 'insert_into_subflow' | 'extract_from_subflow'
  block_id: string
  params?: Record<string, any>
}

export interface EditWorkflowParams {
  operations: EditWorkflowOperation[]
  workflowId: string
  currentUserWorkflow?: string
}

export interface EdgeHandleValidationResult {
  valid: boolean
  error?: string
  /** The normalized handle to use (e.g., simple 'if' normalized to 'condition-{uuid}') */
  normalizedHandle?: string
}

/**
 * Result of applying operations to workflow state
 */
export interface ApplyOperationsResult {
  state: any
  validationErrors: ValidationError[]
  skippedItems: SkippedItem[]
}

export interface OperationContext {
  modifiedState: any
  skippedItems: SkippedItem[]
  validationErrors: ValidationError[]
  permissionConfig: PermissionGroupConfig | null
  deferredConnections: Array<{
    blockId: string
    connections: Record<string, any>
  }>
}
