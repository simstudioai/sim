import {
  parsePrincipal,
  serializePrincipal,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { normalizeStringArray } from '@/lib/core/utils/arrays'
import { normalizeWorkflowVariables } from '@/lib/core/utils/records'
import type { ExecutionMetadata, SerializableExecutionState } from '@/executor/execution/types'

const EXECUTION_SNAPSHOT_VERSION = 1
const LEGACY_PAUSE_SESSION_ID = 'legacy-paused-execution'

function requireLegacyMetadataString(
  metadata: Record<string, unknown>,
  field: 'userId' | 'workflowId' | 'workspaceId'
): string {
  const value = metadata[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Legacy execution snapshot metadata ${field} must be a non-empty string`)
  }
  return value
}

/** Restores only identity that the pre-principal snapshot format recorded unambiguously. */
function parseLegacyPrincipal(metadata: Record<string, unknown>): WorkflowExecutionPrincipal {
  const workflowId = requireLegacyMetadataString(metadata, 'workflowId')
  const workspaceId = requireLegacyMetadataString(metadata, 'workspaceId')
  if (metadata.sessionUserId !== undefined) {
    if (typeof metadata.sessionUserId !== 'string' || !metadata.sessionUserId.trim()) {
      throw new Error('Legacy execution snapshot metadata sessionUserId must be a non-empty string')
    }
    return {
      kind: 'session',
      userId: metadata.sessionUserId,
      sessionId: LEGACY_PAUSE_SESSION_ID,
    }
  }
  if (metadata.enforceCredentialAccess === true) {
    return {
      kind: 'session',
      userId: requireLegacyMetadataString(metadata, 'userId'),
      sessionId: LEGACY_PAUSE_SESSION_ID,
    }
  }
  return { kind: 'system', serviceId: 'internal', workspaceId, workflowId }
}

export class ExecutionSnapshot {
  public readonly metadata: ExecutionMetadata
  public readonly workflow: any
  public readonly input: any
  public readonly workflowVariables: Record<string, any>
  public readonly selectedOutputs: string[]
  public readonly state?: SerializableExecutionState

  constructor(
    metadata: ExecutionMetadata,
    workflow: any,
    input: any,
    workflowVariables: unknown,
    selectedOutputs: unknown = [],
    state?: SerializableExecutionState
  ) {
    this.metadata = metadata
    this.workflow = workflow
    this.input = input
    this.workflowVariables = normalizeWorkflowVariables(workflowVariables)
    this.selectedOutputs = normalizeStringArray(selectedOutputs)
    this.state = state
  }

  toJSON(): string {
    return JSON.stringify({
      metadata: {
        ...this.metadata,
        principal: serializePrincipal(this.metadata.principal),
      },
      version: EXECUTION_SNAPSHOT_VERSION,
      workflow: this.workflow,
      input: this.input,
      workflowVariables: this.workflowVariables,
      selectedOutputs: this.selectedOutputs,
      state: this.state,
    })
  }

  static fromJSON(json: string): ExecutionSnapshot {
    const data: unknown = JSON.parse(json)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Execution snapshot must be an object')
    }
    const parsed = data as Record<string, unknown>
    if (!parsed.metadata || typeof parsed.metadata !== 'object' || Array.isArray(parsed.metadata)) {
      throw new Error('Execution snapshot metadata must be an object')
    }
    const serializedMetadata = parsed.metadata as Record<string, unknown>
    let principal: WorkflowExecutionPrincipal
    if (parsed.version === EXECUTION_SNAPSHOT_VERSION) {
      if (serializedMetadata.principal === undefined) {
        throw new Error('Execution snapshot metadata is missing its principal')
      }
      principal = parsePrincipal(serializedMetadata.principal)
    } else if (parsed.version === undefined) {
      if (serializedMetadata.principal !== undefined) {
        throw new Error('Unversioned execution snapshots cannot contain a principal')
      }
      principal = parseLegacyPrincipal(serializedMetadata)
    } else {
      throw new Error(`Unsupported execution snapshot version ${String(parsed.version)}`)
    }
    const metadata = {
      ...serializedMetadata,
      principal,
    } as ExecutionMetadata
    return new ExecutionSnapshot(
      metadata,
      parsed.workflow,
      parsed.input,
      parsed.workflowVariables,
      parsed.selectedOutputs,
      parsed.state as SerializableExecutionState | undefined
    )
  }
}
