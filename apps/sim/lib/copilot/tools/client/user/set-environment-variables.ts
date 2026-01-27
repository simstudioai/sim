import { createLogger } from '@sim/logger'
import { Loader2, Settings2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { useEnvironmentStore } from '@/stores/settings/environment'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface SetEnvArgs {
  variables: Record<string, string>
  workflowId?: string
}

export class SetEnvironmentVariablesClientTool extends BaseClientTool {
  static readonly id = 'set_environment_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      SetEnvironmentVariablesClientTool.id,
      SetEnvironmentVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to set environment variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Set environment variables?', icon: Settings2 },
      [ClientToolCallState.executing]: { text: 'Setting environment variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Set environment variables', icon: Settings2 },
      [ClientToolCallState.error]: { text: 'Failed to set environment variables', icon: X },
      [ClientToolCallState.aborted]: {
        text: 'Aborted setting environment variables',
        icon: XCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped setting environment variables',
        icon: XCircle,
      },
    },
    interrupt: {
      accept: { text: 'Apply', icon: Settings2 },
      reject: { text: 'Skip', icon: XCircle },
    },
    uiConfig: {
      alwaysExpanded: true,
      interrupt: {
        accept: { text: 'Apply', icon: Settings2 },
        reject: { text: 'Skip', icon: XCircle },
        showAllowOnce: true,
        showAllowAlways: true,
      },
      paramsTable: {
        columns: [
          { key: 'name', label: 'Variable', width: '36%', editable: true },
          { key: 'value', label: 'Value', width: '64%', editable: true, mono: true },
        ],
        extractRows: (params) => {
          const variables = params.variables || {}
          const entries = Array.isArray(variables)
            ? variables.map((v: any, i: number) => [String(i), v.name || `var_${i}`, v.value || ''])
            : Object.entries(variables).map(([key, val]) => {
                if (typeof val === 'object' && val !== null && 'value' in (val as any)) {
                  return [key, key, (val as any).value]
                }
                return [key, key, val]
              })
          return entries as Array<[string, ...any[]]>
        },
      },
    },
    getDynamicText: (params, state) => {
      if (params?.variables && typeof params.variables === 'object') {
        const count = Object.keys(params.variables).length
        const varText = count === 1 ? 'variable' : 'variables'

        switch (state) {
          case ClientToolCallState.success:
            return `Set ${count} ${varText}`
          case ClientToolCallState.executing:
            return `Setting ${count} ${varText}`
          case ClientToolCallState.generating:
            return `Preparing to set ${count} ${varText}`
          case ClientToolCallState.pending:
            return `Set ${count} ${varText}?`
          case ClientToolCallState.error:
            return `Failed to set ${count} ${varText}`
          case ClientToolCallState.aborted:
            return `Aborted setting ${count} ${varText}`
          case ClientToolCallState.rejected:
            return `Skipped setting ${count} ${varText}`
        }
      }
      return undefined
    },
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: SetEnvArgs): Promise<void> {
    const logger = createLogger('SetEnvironmentVariablesClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const payload: SetEnvArgs = { ...(args || { variables: {} }) }
      if (!payload.workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (activeWorkflowId) payload.workflowId = activeWorkflowId
      }
      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'set_environment_variables', payload }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Environment variables updated', parsed.result)
      this.setState(ClientToolCallState.success)

      // Refresh the environment store so the UI reflects the new variables
      try {
        await useEnvironmentStore.getState().loadEnvironmentVariables()
        logger.info('Environment store refreshed after setting variables')
      } catch (error) {
        logger.warn('Failed to refresh environment store:', error)
      }
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to set environment variables')
    }
  }

  async execute(args?: SetEnvArgs): Promise<void> {
    await this.handleAccept(args)
  }
}

// Register UI config at module load
registerToolUIConfig(
  SetEnvironmentVariablesClientTool.id,
  SetEnvironmentVariablesClientTool.metadata.uiConfig!
)
