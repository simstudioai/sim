import { createLogger } from '@sim/logger'
import { Loader2, Settings2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface OperationItem {
  operation: 'add' | 'edit' | 'delete'
  name: string
  type?: 'plain' | 'number' | 'boolean' | 'array' | 'object'
  value?: string
}

interface SetGlobalVarsArgs {
  operations: OperationItem[]
  workflowId?: string
}

export class SetGlobalWorkflowVariablesClientTool extends BaseClientTool {
  static readonly id = 'set_global_workflow_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      SetGlobalWorkflowVariablesClientTool.id,
      SetGlobalWorkflowVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Preparing to set workflow variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Set workflow variables?', icon: Settings2 },
      [ClientToolCallState.executing]: { text: 'Setting workflow variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Updated workflow variables', icon: Settings2 },
      [ClientToolCallState.error]: { text: 'Failed to set workflow variables', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted setting variables', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped setting variables', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Apply', icon: Settings2 },
      reject: { text: 'Skip', icon: XCircle },
    },
    uiConfig: {
      interrupt: {
        accept: { text: 'Apply', icon: Settings2 },
        reject: { text: 'Skip', icon: XCircle },
        showAllowOnce: true,
        showAllowAlways: true,
      },
      paramsTable: {
        columns: [
          { key: 'name', label: 'Name', width: '40%', editable: true, mono: true },
          { key: 'value', label: 'Value', width: '60%', editable: true, mono: true },
        ],
        extractRows: (params) => {
          const operations = params.operations || []
          return operations.map((op: any, idx: number) => [
            String(idx),
            op.name || '',
            String(op.value ?? ''),
          ])
        },
      },
    },
    getDynamicText: (params, state) => {
      if (params?.operations && Array.isArray(params.operations)) {
        const varNames = params.operations
          .slice(0, 2)
          .map((op: any) => op.name)
          .filter(Boolean)

        if (varNames.length > 0) {
          const varList = varNames.join(', ')
          const more = params.operations.length > 2 ? '...' : ''
          const displayText = `${varList}${more}`

          switch (state) {
            case ClientToolCallState.success:
              return `Set ${displayText}`
            case ClientToolCallState.executing:
              return `Setting ${displayText}`
            case ClientToolCallState.generating:
              return `Preparing to set ${displayText}`
            case ClientToolCallState.pending:
              return `Set ${displayText}?`
            case ClientToolCallState.error:
              return `Failed to set ${displayText}`
            case ClientToolCallState.aborted:
              return `Aborted setting ${displayText}`
            case ClientToolCallState.rejected:
              return `Skipped setting ${displayText}`
          }
        }
      }
      return undefined
    },
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: SetGlobalVarsArgs): Promise<void> {
    const logger = createLogger('SetGlobalWorkflowVariablesClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const payload: SetGlobalVarsArgs = { ...(args || { operations: [] }) }
      if (!payload.workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (activeWorkflowId) payload.workflowId = activeWorkflowId
      }
      if (!payload.workflowId) {
        throw new Error('No active workflow found')
      }

      // Fetch current variables so we can construct full array payload
      const getRes = await fetch(`/api/workflows/${payload.workflowId}/variables`, {
        method: 'GET',
      })
      if (!getRes.ok) {
        const txt = await getRes.text().catch(() => '')
        throw new Error(txt || 'Failed to load current variables')
      }
      const currentJson = await getRes.json()
      const currentVarsRecord = (currentJson?.data as Record<string, any>) || {}

      // Helper to convert string -> typed value
      function coerceValue(
        value: string | undefined,
        type?: 'plain' | 'number' | 'boolean' | 'array' | 'object'
      ) {
        if (value === undefined) return value
        const t = type || 'plain'
        try {
          if (t === 'number') {
            const n = Number(value)
            if (Number.isNaN(n)) return value
            return n
          }
          if (t === 'boolean') {
            const v = String(value).trim().toLowerCase()
            if (v === 'true') return true
            if (v === 'false') return false
            return value
          }
          if (t === 'array' || t === 'object') {
            const parsed = JSON.parse(value)
            if (t === 'array' && Array.isArray(parsed)) return parsed
            if (t === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed))
              return parsed
            return value
          }
        } catch {}
        return value
      }

      // Build mutable map by variable name
      const byName: Record<string, any> = {}
      Object.values(currentVarsRecord).forEach((v: any) => {
        if (v && typeof v === 'object' && v.id && v.name) byName[String(v.name)] = v
      })

      // Apply operations in order
      for (const op of payload.operations || []) {
        const key = String(op.name)
        const nextType = (op.type as any) || byName[key]?.type || 'plain'
        if (op.operation === 'delete') {
          delete byName[key]
          continue
        }
        const typedValue = coerceValue(op.value, nextType)
        if (op.operation === 'add') {
          byName[key] = {
            id: crypto.randomUUID(),
            workflowId: payload.workflowId,
            name: key,
            type: nextType,
            value: typedValue,
          }
          continue
        }
        if (op.operation === 'edit') {
          if (!byName[key]) {
            // If editing a non-existent variable, create it
            byName[key] = {
              id: crypto.randomUUID(),
              workflowId: payload.workflowId,
              name: key,
              type: nextType,
              value: typedValue,
            }
          } else {
            byName[key] = {
              ...byName[key],
              type: nextType,
              ...(op.value !== undefined ? { value: typedValue } : {}),
            }
          }
        }
      }

      // Convert byName (keyed by name) to record keyed by ID for the API
      const variablesRecord: Record<string, any> = {}
      for (const v of Object.values(byName)) {
        variablesRecord[v.id] = v
      }

      // POST full variables record to persist
      const res = await fetch(`/api/workflows/${payload.workflowId}/variables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables: variablesRecord }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Failed to update variables (${res.status})`)
      }

      try {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (activeWorkflowId) {
          // Fetch the updated variables from the API
          const refreshRes = await fetch(`/api/workflows/${activeWorkflowId}/variables`, {
            method: 'GET',
          })

          if (refreshRes.ok) {
            const refreshJson = await refreshRes.json()
            const updatedVarsRecord = (refreshJson?.data as Record<string, any>) || {}

            // Update the variables store with the fresh data
            useVariablesStore.setState((state) => {
              // Remove old variables for this workflow
              const withoutWorkflow = Object.fromEntries(
                Object.entries(state.variables).filter(([, v]) => v.workflowId !== activeWorkflowId)
              )
              // Add the updated variables
              return {
                variables: { ...withoutWorkflow, ...updatedVarsRecord },
              }
            })

            logger.info('Refreshed variables in store', { workflowId: activeWorkflowId })
          }
        }
      } catch (refreshError) {
        logger.warn('Failed to refresh variables in store', { error: refreshError })
      }

      await this.markToolComplete(200, 'Workflow variables updated', { variables: byName })
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e)
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, message || 'Failed to set workflow variables')
    }
  }

  async execute(args?: SetGlobalVarsArgs): Promise<void> {
    await this.handleAccept(args)
  }
}

// Register UI config at module load
registerToolUIConfig(
  SetGlobalWorkflowVariablesClientTool.id,
  SetGlobalWorkflowVariablesClientTool.metadata.uiConfig!
)
