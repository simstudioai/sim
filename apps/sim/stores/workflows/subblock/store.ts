import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { populateTriggerFieldsFromConfig } from '@/hooks/use-trigger-config-aggregation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { SubBlockStore, SubBlockValue } from '@/stores/workflows/subblock/types'
import { isTriggerValid } from '@/triggers'

const logger = createLogger('SubBlockStore')

/**
 * Stable empty fallback for `state.workflowValues[workflowId]` selectors.
 * Using a module-level constant avoids returning a fresh `{}` on every
 * selector call, which would defeat Zustand's `Object.is` equality.
 */
export const EMPTY_SUBBLOCK_VALUES: Record<string, Record<string, SubBlockValue>> = {}

/**
 * Stable empty fallback for a single block's sub-block values.
 */
export const EMPTY_BLOCK_SUBBLOCK_VALUES: Record<string, SubBlockValue> = {}

/**
 * SubBlockState stores values for all subblocks in workflows.
 *
 * Architecture: values deliberately live here, split from the workflow store's
 * block structure, so per-keystroke edits do not re-render the canvas graph.
 * The structure keeps a copy of each value from hydration time only — it goes
 * stale as soon as a value is edited (except condition/router dynamic-handle
 * subblocks, which dual-write the structure because edge handles derive from
 * it). Whenever full state is needed (change detection, export, manual runs,
 * diffs), mergeSubblockState/mergeSubblockStateWithValues joins this store
 * onto the structure.
 *
 * Value semantics at that join (single source of truth for the contract):
 * - Key present with any value, including null: this store wins. Null means
 *   the user explicitly cleared the field — it must NOT fall back to the
 *   structure's stale copy, or cleared fields resurrect in comparisons and
 *   serialization while the DB (correctly) holds null.
 * - Key absent or undefined: no value recorded; the structure's value stands.
 * - initializeFromWorkflow seeds every structure key (nulls included) at
 *   hydration, so post-hydration "present with null" is always meaningful.
 *
 * Persistence: user-authored edits flow through collaborativeSetSubblockValue,
 * which updates this store and queues the identical value to the realtime
 * server — the client's merged state and the DB draft stay equivalent, which
 * is what keeps deploy-time change detection honest (deploy snapshots the DB
 * draft). Direct setValue callers do not persist, and each is safe for a
 * different reason: remote-broadcast application (already persisted
 * server-side), undo/redo (persists via its own queued inverse operations),
 * webhook management (writes trigger-runtime ids the comparison excludes), and
 * populateTriggerFieldsFromConfig (values derived from the persisted
 * triggerConfig aggregate, compensated via normalizeTriggerConfigValues).
 */

export const useSubBlockStore = create<SubBlockStore>()(
  devtools((set, get) => ({
    workflowValues: {},

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
                id: generateId(),
                cells: { Key: '', Value: '' },
              }
            }

            const needsId = !row.id
            const needsCells = !row.cells || typeof row.cells !== 'object'
            if (!needsId && !needsCells) {
              return row
            }
            if (needsCells) {
              logger.warn('Fixing malformed table row cells', { blockId, subBlockId, row })
            }

            /**
             * Repair on a copy: the incoming rows are shared with the caller
             * (component state, socket payloads), and mutating them in place
             * corrupts state owned elsewhere. Valid rows keep their identity.
             */
            return {
              ...row,
              ...(needsId ? { id: generateId() } : {}),
              ...(needsCells ? { cells: { Key: '', Value: '' } } : {}),
            }
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
        }
      })
    },
    setWorkflowValues: (workflowId: string, values: Record<string, Record<string, any>>) => {
      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [workflowId]: values,
        },
      }))
    },
  }))
)
