import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SubBlockConfig } from '@/blocks/types'
import { useEnvironmentStore } from '../../settings/environment/store'
import { useGeneralStore } from '../../settings/general/store'
import { useWorkflowRegistry } from '../registry/store'
// Removed workflowSync import - Socket.IO handles real-time sync
import type { SubBlockStore } from './types'
import { extractEnvVarName, findMatchingEnvVar, isEnvVarReference } from './utils'

// Removed debounce sync - Socket.IO handles real-time sync immediately

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
    // Initialize tool params-related state
    toolParams: {},
    clearedParams: {},

    setValue: (blockId: string, subBlockId: string, value: any) => {
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!activeWorkflowId) return

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: {
            ...state.workflowValues[activeWorkflowId],
            [blockId]: {
              ...state.workflowValues[activeWorkflowId]?.[blockId],
              [subBlockId]: value,
            },
          },
        },
      }))

      // Trigger debounced sync to DB
      get().syncWithDB()
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

      // Note: Socket.IO handles real-time sync automatically
    },

    initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => {
      // Initialize from blocks
      const values: Record<string, Record<string, any>> = {}
      Object.entries(blocks).forEach(([blockId, block]) => {
        values[blockId] = {}
        Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]) => {
          values[blockId][subBlockId] = (subBlock as SubBlockConfig).value
        })
      })

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [workflowId]: values,
        },
      }))
    },

    // Removed syncWithDB - Socket.IO handles real-time sync automatically
    syncWithDB: () => {
      // No-op: Socket.IO handles real-time sync
    },

    // Tool params related functionality
    setToolParam: (toolId: string, paramId: string, value: string) => {
      // If setting a non-empty value, we should remove it from clearedParams if it exists
      if (value.trim() !== '') {
        set((state) => {
          const newClearedParams = { ...state.clearedParams }
          if (newClearedParams[toolId]?.[paramId]) {
            delete newClearedParams[toolId][paramId]
            // Clean up empty objects
            if (Object.keys(newClearedParams[toolId]).length === 0) {
              delete newClearedParams[toolId]
            }
          }

          return { clearedParams: newClearedParams }
        })
      }

      // Set the parameter value
      set((state) => ({
        toolParams: {
          ...state.toolParams,
          [toolId]: {
            ...(state.toolParams[toolId] || {}),
            [paramId]: value,
          },
        },
      }))

      // For API keys, also store under a normalized tool name for cross-referencing
      // This allows both blocks and tools to share the same parameters
      if (paramId.toLowerCase() === 'apikey' || paramId.toLowerCase() === 'api_key') {
        // Extract the tool name part (e.g., "exa" from "exa-search")
        const baseTool = toolId.split('-')[0].toLowerCase()

        if (baseTool !== toolId) {
          // Set the same value for the base tool to enable cross-referencing
          set((state) => ({
            toolParams: {
              ...state.toolParams,
              [baseTool]: {
                ...(state.toolParams[baseTool] || {}),
                [paramId]: value,
              },
            },
          }))
        }
      }
    },

    markParamAsCleared: (instanceId: string, paramId: string) => {
      // Mark this specific instance as cleared
      set((state) => ({
        clearedParams: {
          ...state.clearedParams,
          [instanceId]: {
            ...(state.clearedParams[instanceId] || {}),
            [paramId]: true,
          },
        },
      }))
    },

    unmarkParamAsCleared: (instanceId: string, paramId: string) => {
      // Remove the cleared flag for this parameter
      set((state) => {
        const newClearedParams = { ...state.clearedParams }
        if (newClearedParams[instanceId]?.[paramId]) {
          delete newClearedParams[instanceId][paramId]
          // Clean up empty objects
          if (Object.keys(newClearedParams[instanceId]).length === 0) {
            delete newClearedParams[instanceId]
          }
        }
        return { clearedParams: newClearedParams }
      })
    },

    isParamCleared: (instanceId: string, paramId: string) => {
      // Only check this specific instance
      return !!get().clearedParams[instanceId]?.[paramId]
    },

    getToolParam: (toolId: string, paramId: string) => {
      // Check for direct match first
      const directValue = get().toolParams[toolId]?.[paramId]
      if (directValue) return directValue

      // Try base tool name if it's a compound tool ID
      if (toolId.includes('-')) {
        const baseTool = toolId.split('-')[0].toLowerCase()
        return get().toolParams[baseTool]?.[paramId]
      }

      // Try matching against any stored tool that starts with this ID
      // This helps match "exa" with "exa-search" etc.
      const matchingToolIds = Object.keys(get().toolParams).filter(
        (id) => id.startsWith(toolId) || id.split('-')[0] === toolId
      )

      for (const id of matchingToolIds) {
        const value = get().toolParams[id]?.[paramId]
        if (value) return value
      }

      return undefined
    },

    getToolParams: (toolId: string) => {
      return get().toolParams[toolId] || {}
    },

    isEnvVarReference,

    resolveToolParamValue: (toolId: string, paramId: string, instanceId?: string) => {
      // If this is a specific instance that has been deliberately cleared, don't auto-fill it
      if (instanceId && get().isParamCleared(instanceId, paramId)) {
        return undefined
      }

      // Check if auto-fill environment variables is enabled
      const isAutoFillEnvVarsEnabled = useGeneralStore.getState().isAutoFillEnvVarsEnabled
      if (!isAutoFillEnvVarsEnabled) {
        // When auto-fill is disabled, we still return existing stored values, but don't
        // attempt to resolve environment variables or set new values
        return get().toolParams[toolId]?.[paramId]
      }

      const envStore = useEnvironmentStore.getState()

      // First check params store for previously entered value
      const storedValue = get().getToolParam(toolId, paramId)

      if (storedValue) {
        // If the stored value is an environment variable reference like {{EXA_API_KEY}}
        if (isEnvVarReference(storedValue)) {
          // Extract variable name from {{VAR_NAME}}
          const envVarName = extractEnvVarName(storedValue)
          if (!envVarName) return undefined

          // Check if this environment variable still exists
          const envValue = envStore.getVariable(envVarName)

          if (envValue) {
            // Environment variable exists, return the reference
            return storedValue
          }
          // Environment variable no longer exists
          return undefined
        }

        // Return the stored value directly if it's not an env var reference
        return storedValue
      }

      // If no stored value, try to guess based on parameter name
      // This handles cases where the user hasn't entered a value yet
      if (paramId.toLowerCase() === 'apikey' || paramId.toLowerCase() === 'api_key') {
        const matchingVar = findMatchingEnvVar(toolId)
        if (matchingVar) {
          const envReference = `{{${matchingVar}}}`
          get().setToolParam(toolId, paramId, envReference)
          return envReference
        }
      }

      // No value found
      return undefined
    },

    clearToolParams: () => {
      set({ toolParams: {}, clearedParams: {} })
    },
  }))
)
