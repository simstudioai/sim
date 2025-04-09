import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { useEnvironmentStore } from '../settings/environment/store'
import { useGeneralStore } from '../settings/general/store'
import { ToolParamsStore } from './types'
import { extractEnvVarName, findMatchingEnvVar, isEnvVarReference } from './utils'

export const useToolParamsStore = create<ToolParamsStore>()(
  devtools(
    persist(
      (set, get) => ({
        params: {},
        clearedParams: {},

        setParam: (toolId: string, paramId: string, value: string) => {
          // If setting a non-empty value, we should remove it from clearedParams if it exists
          if (value.trim() !== '') {
            set((state) => {
              const newClearedParams = { ...state.clearedParams }
              if (newClearedParams[toolId] && newClearedParams[toolId][paramId]) {
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
            params: {
              ...state.params,
              [toolId]: {
                ...(state.params[toolId] || {}),
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
                params: {
                  ...state.params,
                  [baseTool]: {
                    ...(state.params[baseTool] || {}),
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

        isParamCleared: (instanceId: string, paramId: string) => {
          // Only check this specific instance
          return !!get().clearedParams[instanceId]?.[paramId]
        },

        getParam: (toolId: string, paramId: string) => {
          // Check for direct match first
          const directValue = get().params[toolId]?.[paramId]
          if (directValue) return directValue

          // Try base tool name if it's a compound tool ID
          if (toolId.includes('-')) {
            const baseTool = toolId.split('-')[0].toLowerCase()
            return get().params[baseTool]?.[paramId]
          }

          // Try matching against any stored tool that starts with this ID
          // This helps match "exa" with "exa-search" etc.
          const matchingToolIds = Object.keys(get().params).filter(
            (id) => id.startsWith(toolId) || id.split('-')[0] === toolId
          )

          for (const id of matchingToolIds) {
            const value = get().params[id]?.[paramId]
            if (value) return value
          }

          return undefined
        },

        getToolParams: (toolId: string) => {
          return get().params[toolId] || {}
        },

        isEnvVarReference,

        resolveParamValue: (toolId: string, paramId: string, instanceId?: string) => {
          // If this is a specific instance that has been deliberately cleared, don't auto-fill it
          if (instanceId && get().isParamCleared(instanceId, paramId)) {
            return undefined
          }

          // Check if auto-fill environment variables is enabled
          const isAutoFillEnvVarsEnabled = useGeneralStore.getState().isAutoFillEnvVarsEnabled
          if (!isAutoFillEnvVarsEnabled) {
            // When auto-fill is disabled, we still return existing stored values, but don't
            // attempt to resolve environment variables or set new values
            return get().params[toolId]?.[paramId]
          }

          const envStore = useEnvironmentStore.getState()

          // First check params store for previously entered value
          const storedValue = get().getParam(toolId, paramId)

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
              } else {
                // Environment variable no longer exists
                return undefined
              }
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
              get().setParam(toolId, paramId, envReference)
              return envReference
            }
          }

          // No value found
          return undefined
        },

        clear: () => {
          set({ params: {}, clearedParams: {} })
        },
      }),
      {
        name: 'tool-params-store',
      }
    )
  )
)
