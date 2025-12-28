/**
 * Type definitions for workflow templates
 *
 * These types ensure type safety when creating and seeding workflow templates.
 * They mirror the database schema for workflows, blocks, and edges.
 */

/**
 * Represents a sub-block configuration within a workflow block
 * Sub-blocks are the individual form fields/inputs within a block
 */
export interface SubBlockConfig {
  /** Unique identifier for the sub-block */
  id: string
  /** Current value of the sub-block */
  value: string | number | boolean | object | null
  /** Type of input (dropdown, short-input, code, etc.) */
  type?: string
  /** Whether this field is required */
  required?: boolean
}

/**
 * Represents a single workflow block (node) in the canvas
 */
export interface WorkflowBlock {
  /** Unique identifier for the block */
  id: string
  /** Block type (e.g., 'quickbooks', 'plaid', 'stripe', 'resend') */
  type: string
  /** Display name of the block */
  name: string
  /** X coordinate position on the canvas */
  positionX: number
  /** Y coordinate position on the canvas */
  positionY: number
  /** Whether the block is enabled */
  enabled: boolean
  /** Whether handles are horizontal (true) or vertical (false) */
  horizontalHandles: boolean
  /** Whether the block uses wide layout */
  isWide: boolean
  /** Whether advanced mode is enabled */
  advancedMode: boolean
  /** Whether this block is a trigger block */
  triggerMode: boolean
  /** Block height in pixels */
  height: number
  /** Sub-block configurations (form field values) */
  subBlocks: Record<string, SubBlockConfig>
  /** Block output data */
  outputs: Record<string, any>
  /** Additional block data */
  data: Record<string, any>
}

/**
 * Represents a connection (edge) between two workflow blocks
 */
export interface WorkflowEdge {
  /** Unique identifier for the edge */
  id: string
  /** ID of the source block */
  sourceBlockId: string
  /** ID of the target block */
  targetBlockId: string
  /** Handle ID on the source block (optional) */
  sourceHandle?: string | null
  /** Handle ID on the target block (optional) */
  targetHandle?: string | null
}

/**
 * Complete workflow state including blocks, edges, and metadata
 */
export interface WorkflowState {
  /** Array of all blocks in the workflow */
  blocks: WorkflowBlock[]
  /** Array of all edges connecting the blocks */
  edges: WorkflowEdge[]
  /** Workflow-level variables */
  variables?: Record<string, any>
  /** Canvas viewport position */
  viewport?: {
    x: number
    y: number
    zoom: number
  }
}

/**
 * Credential requirement for a template
 */
export interface CredentialRequirement {
  /** Provider ID (e.g., 'quickbooks', 'plaid', 'stripe') */
  provider: string
  /** Service ID within the provider */
  service: string
  /** Human-readable description of what the credential is used for */
  purpose: string
  /** Whether this credential is required or optional */
  required: boolean
}

/**
 * Template metadata and configuration
 */
export interface TemplateMetadata {
  /** Unique identifier for the template (used for upsert) */
  id: string
  /** Template name */
  name: string
  /** Short description of what the template does */
  description: string
  /** Detailed explanation (markdown supported) */
  details?: string
  /** Array of tags for categorization */
  tags: string[]
  /** Required OAuth/API credentials */
  requiredCredentials: CredentialRequirement[]
  /** Template creator ID (use 'sim-official' for official templates) */
  creatorId: string
  /** Template status */
  status: 'pending' | 'approved' | 'rejected'
}

/**
 * Complete template definition ready for database insertion
 */
export interface TemplateDefinition {
  /** Template metadata */
  metadata: TemplateMetadata
  /** Workflow state (blocks and edges) */
  state: WorkflowState
}

/**
 * Result of template seeding operation
 */
export interface SeedResult {
  /** Template ID */
  templateId: string
  /** Template name */
  name: string
  /** Whether the template was newly created (inserted) */
  inserted: boolean
  /** Whether an existing template was updated */
  updated: boolean
  /** Any error that occurred */
  error?: string
}

/**
 * Summary of seeding operation
 */
export interface SeedSummary {
  /** Total templates processed */
  total: number
  /** Number of new templates inserted */
  inserted: number
  /** Number of existing templates updated */
  updated: number
  /** Number of failures */
  failed: number
  /** Individual results for each template */
  results: SeedResult[]
}
