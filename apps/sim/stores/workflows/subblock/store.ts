import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { populateTriggerFieldsFromConfig } from '@/hooks/use-trigger-config-aggregation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { SubBlockStore } from '@/stores/workflows/subblock/types'
import { isTriggerValid } from '@/triggers'

const logger = createLogger('SubBlockStore')

/**
 * SubBlockState stores values for all subblocks in workflows
 *
 * Important implementation notes:
 * 1. Values are stored per workflow, per block, per subblock
 * 2. When workflows are synced to the database, the mergeSubblockState function
 *    in utils.ts combines the block structure with these values
 * 3. If a subblock value exists here but not in the block structure
 *    (e.g., inputFormat in starter block), the merge function will include it
 *    in the synchronized state to ensure persistence
 */

export const useSubBlockStore = create<SubBlockStore>()(
  devtools((set, get) => ({
    workflowValues: {},
    loadingWebhooks: new Set<string>(),
    checkedWebhooks: new Set<string>(),
    loadingSchedules: new Set<string>(),
    checkedSchedules: new Set<string>(),

    setValue: (blockId: string, subBlockId: string, value: any) => {
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!activeWorkflowId) return

      let validatedValue = value
      if (Array.isArray(value)) {
        const isTableData =
          value.length > 0 &&
          value.some((item) => item && typeof item === 'object' && 'cells' in item)

        if (isTableData) {
          logger.debug('Validating table data for subblock', { blockId, subBlockId })
          validatedValue = value.map((row: any) => {
            if (!row || typeof row !== 'object') {
              logger.warn('Fixing malformed table row', { blockId, subBlockId, row })
              return {
                id: crypto.randomUUID(),
                cells: { Key: '', Value: '' },
              }
            }

            if (!row.id) {
              row.id = crypto.randomUUID()
            }

            if (!row.cells || typeof row.cells !== 'object') {
              logger.warn('Fixing malformed table row cells', { blockId, subBlockId, row })
              row.cells = { Key: '', Value: '' }
            }

            return row
          })
        }
      }

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: {
            ...state.workflowValues[activeWorkflowId],
            [blockId]: {
              ...state.workflowValues[activeWorkflowId]?.[blockId],
              [subBlockId]: validatedValue,
            },
          },
        },
      }))
    },

    getValue: (blockId: string, subBlockId: string) => {
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!activeWorkflowId) return null

      return get().workflowValues[activeWorkflowId]?.[blockId]?.[subBlockId] ?? null
    },

    clear: () => {
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!activeWorkflowId) return

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: {},
        },
      }))
    },

    initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => {
      const values: Record<string, Record<string, any>> = {}

      Object.entries(blocks).forEach(([blockId, block]) => {
        values[blockId] = {}
        Object.entries(block.subBlocks || {}).forEach(([subBlockId, subBlock]) => {
          values[blockId][subBlockId] = (subBlock as SubBlockConfig).value
        })
      })

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [workflowId]: values,
        },
      }))

      const originalActiveWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      useWorkflowRegistry.setState({ activeWorkflowId: workflowId })

      Object.entries(blocks).forEach(([blockId, block]) => {
        const blockConfig = getBlock(block.type)
        if (!blockConfig) return

        const isTriggerBlock = blockConfig.category === 'triggers' || block.triggerMode === true
        if (!isTriggerBlock) return

        let triggerId: string | undefined
        if (blockConfig.category === 'triggers') {
          triggerId = block.type
        } else if (block.triggerMode === true && blockConfig.triggers?.enabled) {
          const selectedTriggerIdValue = block.subBlocks?.selectedTriggerId?.value
          const triggerIdValue = block.subBlocks?.triggerId?.value
          triggerId =
            (typeof selectedTriggerIdValue === 'string' && isTriggerValid(selectedTriggerIdValue)
              ? selectedTriggerIdValue
              : undefined) ||
            (typeof triggerIdValue === 'string' && isTriggerValid(triggerIdValue)
              ? triggerIdValue
              : undefined) ||
            blockConfig.triggers?.available?.[0]
        }

        if (!triggerId || !isTriggerValid(triggerId)) {
          return
        }

        const triggerConfigSubBlock = block.subBlocks?.triggerConfig
        if (triggerConfigSubBlock?.value && typeof triggerConfigSubBlock.value === 'object') {
          populateTriggerFieldsFromConfig(blockId, triggerConfigSubBlock.value, triggerId)

          const currentChecked = get().checkedWebhooks
          if (currentChecked.has(blockId)) {
            set((state) => {
              const newSet = new Set(state.checkedWebhooks)
              newSet.delete(blockId)
              return { checkedWebhooks: newSet }
            })
          }
        }
      })

      if (originalActiveWorkflowId !== workflowId) {
        useWorkflowRegistry.setState({ activeWorkflowId: originalActiveWorkflowId })
      }
    },
  }))
)
