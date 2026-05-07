import { normalizeStringArray } from '@/lib/core/utils/arrays'
import { normalizeWorkflowVariables } from '@/lib/core/utils/records'
import type { ExecutionMetadata, SerializableExecutionState } from '@/executor/execution/types'

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
      metadata: this.metadata,
      workflow: this.workflow,
      input: this.input,
      workflowVariables: this.workflowVariables,
      selectedOutputs: this.selectedOutputs,
      state: this.state,
    })
  }

  static fromJSON(json: string): ExecutionSnapshot {
    const data = JSON.parse(json)
    return new ExecutionSnapshot(
      data.metadata,
      data.workflow,
      data.input,
      data.workflowVariables,
      data.selectedOutputs,
      data.state
    )
  }
}
