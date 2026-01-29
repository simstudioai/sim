import { Loader2, MinusCircle, Play, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export class RunWorkflowClientTool extends BaseClientTool {
  static readonly id = 'run_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, RunWorkflowClientTool.id, RunWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to run your workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Run this workflow?', icon: Play },
      [ClientToolCallState.executing]: { text: 'Running your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Executed workflow', icon: Play },
      [ClientToolCallState.error]: { text: 'Errored running workflow', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped workflow execution', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted workflow execution', icon: MinusCircle },
      [ClientToolCallState.background]: { text: 'Running in background', icon: Play },
    },
    interrupt: {
      accept: { text: 'Run', icon: Play },
      reject: { text: 'Skip', icon: MinusCircle },
    },
    uiConfig: {
      isSpecial: true,
      interrupt: {
        accept: { text: 'Run', icon: Play },
        reject: { text: 'Skip', icon: MinusCircle },
        showAllowOnce: true,
        showAllowAlways: true,
      },
      secondaryAction: {
        text: 'Move to Background',
        title: 'Move to Background',
        variant: 'tertiary',
        showInStates: [ClientToolCallState.executing],
        completionMessage:
          'The user has chosen to move the workflow execution to the background. Check back with them later to know when the workflow execution is complete',
        targetState: ClientToolCallState.background,
      },
      paramsTable: {
        columns: [
          { key: 'input', label: 'Input', width: '36%' },
          { key: 'value', label: 'Value', width: '64%', editable: true, mono: true },
        ],
        extractRows: (params) => {
          let inputs = params.input || params.inputs || params.workflow_input
          if (typeof inputs === 'string') {
            try {
              inputs = JSON.parse(inputs)
            } catch {
              inputs = {}
            }
          }
          if (params.workflow_input && typeof params.workflow_input === 'object') {
            inputs = params.workflow_input
          }
          if (!inputs || typeof inputs !== 'object') {
            const { workflowId, workflow_input, ...rest } = params
            inputs = rest
          }
          const safeInputs = inputs && typeof inputs === 'object' ? inputs : {}
          return Object.entries(safeInputs).map(([key, value]) => [key, key, String(value)])
        },
      },
    },
    getDynamicText: (params, state) => {
      const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
      if (workflowId) {
        const workflowName = useWorkflowRegistry.getState().workflows[workflowId]?.name
        if (workflowName) {
          switch (state) {
            case ClientToolCallState.success:
              return `Ran ${workflowName}`
            case ClientToolCallState.executing:
              return `Running ${workflowName}`
            case ClientToolCallState.generating:
              return `Preparing to run ${workflowName}`
            case ClientToolCallState.pending:
              return `Run ${workflowName}?`
            case ClientToolCallState.error:
              return `Failed to run ${workflowName}`
            case ClientToolCallState.rejected:
              return `Skipped running ${workflowName}`
            case ClientToolCallState.aborted:
              return `Aborted running ${workflowName}`
            case ClientToolCallState.background:
              return `Running ${workflowName} in background`
          }
        }
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only for rendering tool call cards
  // Workflow execution happens entirely on the server
}

// Register UI config at module load
registerToolUIConfig(RunWorkflowClientTool.id, RunWorkflowClientTool.metadata.uiConfig!)
