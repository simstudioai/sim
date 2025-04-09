import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { useEnvironmentStore } from '../settings/environment/store'
import { useGeneralStore } from '../settings/general/store'

const logger = createLogger('Tool Parameters Store')

export interface ToolParamsStore {
  // Store parameters by tool ID and parameter ID
  params: Record<string, Record<string, string>>

  // Track parameters that have been deliberately cleared by the user
  clearedParams: Record<string, Record<string, boolean>>

  // Set a parameter value for a tool
  setParam: (toolId: string, paramId: string, value: string) => void

  // Mark a parameter as deliberately cleared by the user
  markParamAsCleared: (instanceId: string, paramId: string) => void

  // Check if a parameter has been deliberately cleared for this specific instance
  isParamCleared: (instanceId: string, paramId: string) => boolean

  // Get a parameter value for a tool
  getParam: (toolId: string, paramId: string) => string | undefined

  // Get all parameters for a tool
  getToolParams: (toolId: string) => Record<string, string>

  // Check if a value looks like an environment variable reference
  isEnvVarReference: (value: string) => boolean

  // Resolve parameter value, checking env vars first
  resolveParamValue: (toolId: string, paramId: string, instanceId?: string) => string | undefined

  // Clear all stored parameters
  clear: () => void
}

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
          // This allows both "exa" block and "exa" tool in agent to share the same parameters
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

              logger.debug('Cross-referenced parameter value', { baseTool, paramId })
            }
          }

          logger.debug('Stored parameter value', { toolId, paramId })
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

          logger.debug('Marked parameter as cleared for specific instance', { instanceId, paramId })
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

        isEnvVarReference: (value: string) => {
          // Check if the value looks like {{ENV_VAR}}
          return /^\{\{[A-Z0-9_]+\}\}$/.test(value)
        },

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
            if (get().isEnvVarReference(storedValue)) {
              // Extract variable name from {{VAR_NAME}}
              const envVarName = storedValue.slice(2, -2)

              // Check if this environment variable still exists
              const envValue = envStore.getVariable(envVarName)

              if (envValue) {
                // Environment variable exists, return the reference
                return storedValue
              } else {
                // Environment variable no longer exists
                logger.debug(
                  `Environment variable ${envVarName} no longer exists for ${toolId}.${paramId}`
                )

                // Attempt to find a replacement variable that might be a renamed version
                // For example, if EXA_API_KEY was renamed to EXA_KEY
                const toolPrefix = toolId.includes('-')
                  ? toolId.split('-')[0].toUpperCase()
                  : toolId.toUpperCase()
                const possibleReplacements = Object.keys(envStore.getAllVariables()).filter(
                  (key) =>
                    key.startsWith(toolPrefix) &&
                    (key.includes('KEY') || key.includes('TOKEN') || key.includes('SECRET'))
                )

                if (possibleReplacements.length > 0) {
                  // Found a possible replacement - use the first match
                  const newReference = `{{${possibleReplacements[0]}}}`
                  logger.debug(`Found replacement environment variable: ${possibleReplacements[0]}`)

                  // Update the stored parameter to use the new reference
                  get().setParam(toolId, paramId, newReference)
                  return newReference
                }

                // No valid replacement found - don't return an invalid reference
                return undefined
              }
            }

            // Return the stored value directly if it's not an env var reference
            return storedValue
          }

          // If no stored value, try to guess based on parameter name
          // This handles cases where the user hasn't entered a value yet
          if (paramId.toLowerCase() === 'apikey' || paramId.toLowerCase() === 'api_key') {
            // For example, if toolId is 'exa' and param is 'apiKey', look for EXA_API_KEY
            // First extract base tool name if it's a compound ID
            const baseTool = toolId.includes('-') ? toolId.split('-')[0] : toolId
            const toolPrefix = baseTool.toUpperCase()
            const possibleEnvVars = [
              `${toolPrefix}_API_KEY`,
              `${toolPrefix.replace(/-/g, '_')}_API_KEY`,
              `${toolPrefix}_KEY`,
              `${toolPrefix}_TOKEN`,
              `${toolPrefix}`,
            ]

            // Check each possible env var name
            for (const varName of possibleEnvVars) {
              const envValue = envStore.getVariable(varName)
              if (envValue) {
                // Store this value for future use as the environment variable reference
                const envReference = `{{${varName}}}`
                get().setParam(toolId, paramId, envReference)
                return envReference
              }
            }
          }

          // No value found
          return undefined
        },

        clear: () => {
          set({ params: {}, clearedParams: {} })
          logger.debug('Cleared all tool parameters and cleared flags')
        },
      }),
      {
        name: 'tool-params-store',
      }
    )
  )
)
