import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { type ExportWorkflowState, sanitizeForExport } from '@/lib/workflows/json-sanitizer'
import { getWorkflowWithValues } from '@/stores/workflows'
import { useWorkflowRegistry } from '../registry/store'

const logger = createLogger('WorkflowJsonStore')

interface WorkflowJsonStore {
  json: string
  lastGenerated?: number

  generateJson: () => void
  getJson: () => Promise<string>
  refreshJson: () => void
}

export const useWorkflowJsonStore = create<WorkflowJsonStore>()(
  devtools(
    (set, get) => ({
      json: '',
      lastGenerated: undefined,

      generateJson: () => {
        const { activeWorkflowId, workflows } = useWorkflowRegistry.getState()

        if (!activeWorkflowId) {
          logger.warn('No active workflow to generate JSON for')
          return
        }

        try {
          const workflow = getWorkflowWithValues(activeWorkflowId)

          if (!workflow || !workflow.state) {
            logger.warn('No workflow state found for ID:', activeWorkflowId)
            return
          }

          const workflowMetadata = workflows[activeWorkflowId]
          const { useVariablesStore } = require('@/stores/panel/variables/store')
          const workflowVariables = useVariablesStore
            .getState()
            .getVariablesByWorkflowId(activeWorkflowId)

          const workflowState = {
            ...workflow.state,
            metadata: {
              name: workflowMetadata?.name,
              description: workflowMetadata?.description,
              exportedAt: new Date().toISOString(),
            },
            variables: workflowVariables.map((v: any) => ({
              id: v.id,
              name: v.name,
              type: v.type,
              value: v.value,
            })),
          }

          const exportState: ExportWorkflowState = sanitizeForExport(workflowState)

          // Convert to formatted JSON
          const jsonString = JSON.stringify(exportState, null, 2)

          set({
            json: jsonString,
            lastGenerated: Date.now(),
          })

          logger.info('Workflow JSON generated successfully', {
            version: exportState.version,
            exportedAt: exportState.exportedAt,
            blocksCount: Object.keys(exportState.state.blocks).length,
            edgesCount: exportState.state.edges.length,
            jsonLength: jsonString.length,
          })
        } catch (error) {
          logger.error('Failed to generate JSON:', error)
        }
      },

      getJson: async () => {
        const currentTime = Date.now()
        const { json, lastGenerated } = get()

        // Auto-refresh if data is stale (older than 1 second) or never generated
        if (!lastGenerated || currentTime - lastGenerated > 1000) {
          get().generateJson()
          return get().json
        }

        return json
      },

      refreshJson: () => {
        get().generateJson()
      },
    }),
    {
      name: 'workflow-json-store',
    }
  )
)
