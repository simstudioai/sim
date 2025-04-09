import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { useEnvironmentStore } from '../settings/environment/store'

const logger = createLogger('Tool Parameters Store')

export interface ToolParamsStore {
  // Store parameters by tool ID and parameter ID
  params: Record<string, Record<string, string>>

  // Set a parameter value for a tool
  setParam: (toolId: string, paramId: string, value: string) => void

  // Get a parameter value for a tool
  getParam: (toolId: string, paramId: string) => string | undefined

  // Get all parameters for a tool
  getToolParams: (toolId: string) => Record<string, string>

  // Check if a value looks like an environment variable reference
  isEnvVarReference: (value: string) => boolean

  // Resolve parameter value, checking env vars first
  resolveParamValue: (toolId: string, paramId: string) => string | undefined

  // Clear all stored parameters
  clear: () => void
}

export const useToolParamsStore = create<ToolParamsStore>()(
  devtools(
    persist(
      (set, get) => ({
        params: {},

        setParam: (toolId: string, paramId: string, value: string) => {
          // If this is an API key parameter, we should store it
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

        resolveParamValue: (toolId: string, paramId: string) => {
          const envStore = useEnvironmentStore.getState()

          // First check params store for previously entered value
          const storedValue = get().getParam(toolId, paramId)

          if (storedValue) {
            // If the stored value is an environment variable reference like {{EXA_API_KEY}}
            // Always return the original reference, don't resolve it for autofill
            if (get().isEnvVarReference(storedValue)) {
              return storedValue
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
          set({ params: {} })
          logger.debug('Cleared all tool parameters')
        },
      }),
      {
        name: 'tool-params-store',
      }
    )
  )
)
