/**
 * Canonical shapes for the per-workspace API reference doc. These are the domain
 * types the derivation layer produces; the boundary contract in
 * `@/lib/api/contracts/api-reference` mirrors them as Zod (a test asserts the two
 * stay in sync). Structure is always derived live from a workflow's active
 * deployment — never authored — so the doc can never drift from what executes.
 */

/**
 * A deliberately-minimal JSON Schema node. We only emit the subset a caller needs
 * to validate inputs and reason about outputs: a type, an optional description and
 * example, object `properties`, and array `items`. Kept honest and shallow on
 * purpose — this is a contract legibility aid, not a full JSON Schema compiler.
 */
export interface JsonSchemaNode {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  description?: string
  example?: unknown
  /** For `type: 'object'`. */
  properties?: Record<string, JsonSchemaNode>
  /** For `type: 'object'` — field names a caller must send. */
  required?: string[]
  /** For `type: 'array'`. */
  items?: JsonSchemaNode
}

/** How the caller authenticates — describes the existing mechanism, never invents one. */
export interface ApiReferenceAuth {
  type: 'api_key' | 'public'
  /** Header name for `api_key`, else null. */
  header: string | null
  description: string
}

/** Whether a downstream deploy changed the interface in a way that can break callers. */
export interface ApiReferenceVersion {
  version: number
  deployedAt: string | null
  breaking: boolean
  changes: string[]
}

/** Which optional, provider-opted-in visibility is active for this entry. */
export interface ApiReferenceExposure {
  trace: 'off' | 'traceId'
  blocks: boolean
}

/** One published workflow, rendered as a callable endpoint. */
export interface ApiReferenceEntry {
  workflowId: string
  name: string
  summary: string | null
  description: string | null
  /** The currently deployed version — pinned, not "latest". */
  version: number | null
  deployedAt: string | null
  invokeUrl: string
  auth: ApiReferenceAuth
  input: JsonSchemaNode
  output: JsonSchemaNode
  exposure: ApiReferenceExposure
  versions: ApiReferenceVersion[]
}

/** The whole workspace's doc: its identity plus one entry per published workflow. */
export interface ApiReferenceDoc {
  workspaceId: string
  name: string
  generatedAt: string
  entries: ApiReferenceEntry[]
}

/** A single redacted block, for the opt-in `exposeBlocks` introspection. */
export interface RedactedBlock {
  id: string
  type: string
  name: string
  /** Downstream block ids this block feeds, derived from the deployed edges. */
  outgoing: string[]
  /** Allowlisted, non-secret config values only. */
  config: Record<string, unknown>
}
