import {
  parsePrincipal,
  requirePrincipalExecutionMetadata,
  serializePrincipal,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { normalizeStringArray } from '@/lib/core/utils/arrays'
import { normalizeWorkflowVariables } from '@/lib/core/utils/records'
import type { ExecutionMetadata, SerializableExecutionState } from '@/executor/execution/types'

const EXECUTION_SNAPSHOT_VERSION = 2

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
    requirePrincipalExecutionMetadata(this.metadata.principal)
    const principal = serializePrincipal(this.metadata.principal, 2)
    if (principal.version !== 2) {
      throw new Error('Execution snapshot principal must carry execution metadata')
    }
    return JSON.stringify({
      metadata: {
        ...this.metadata,
        principal,
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
    if (parsed.version !== EXECUTION_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported execution snapshot version ${String(parsed.version)}`)
    }
    if (serializedMetadata.principal === undefined) {
      throw new Error('Execution snapshot metadata is missing its principal')
    }
    const principal: WorkflowExecutionPrincipal = parsePrincipal(serializedMetadata.principal)
    requirePrincipalExecutionMetadata(principal)
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
