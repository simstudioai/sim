import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { API_ENDPOINTS } from '@/stores/constants'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { Variable, VariablesStore } from './types'

const logger = createLogger('Variables Store')
const SAVE_DEBOUNCE_DELAY = 500 // 500ms debounce delay

// Map to store debounce timers for each workflow
const saveTimers = new Map<string, NodeJS.Timeout>()
// Track which workflows have already been loaded
const loadedWorkflows = new Set<string>()

// Clear a workspace from the loaded tracking when switching workspaces
export function clearWorkflowVariablesTracking() {
  loadedWorkflows.clear();
}

export const useVariablesStore = create<VariablesStore>()(
  devtools(
    persist(
      (set, get) => ({
        variables: {},
        isLoading: false,
        error: null,
        isEditing: null,

        addVariable: (variable) => {
          const id = crypto.randomUUID()

          // Get variables for this workflow
          const workflowVariables = get().getVariablesByWorkflowId(variable.workflowId)

          // Auto-generate variable name if not provided or it's a default pattern name
          if (!variable.name || /^variable\d+$/.test(variable.name)) {
            // Find the highest existing Variable N number
            const existingNumbers = workflowVariables
              .map((v) => {
                const match = v.name.match(/^variable(\d+)$/)
                return match ? parseInt(match[1]) : 0
              })
              .filter((n) => !isNaN(n))

            // Set new number to max + 1, or 1 if none exist
            const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1

            variable.name = `variable${nextNumber}`
          }

          // Ensure name uniqueness within the workflow
          let uniqueName = variable.name
          let nameIndex = 1

          // Check if name already exists in this workflow
          while (workflowVariables.some((v) => v.name === uniqueName)) {
            uniqueName = `${variable.name} (${nameIndex})`
            nameIndex++
          }

          // Handle initial value
          let variableValue = variable.value

          // Auto-add quotes for string values if they aren't already quoted
          if (
            variable.type === 'string' &&
            typeof variableValue === 'string' &&
            variableValue.trim() !== ''
          ) {
            // Only add quotes if not already properly quoted
            const trimmedValue = variableValue.trim()

            // Check if entire string is already properly quoted
            const isAlreadyQuoted =
              (trimmedValue.startsWith('"') &&
                trimmedValue.endsWith('"') &&
                trimmedValue.length >= 2) ||
              (trimmedValue.startsWith("'") &&
                trimmedValue.endsWith("'") &&
                trimmedValue.length >= 2)

            if (!isAlreadyQuoted) {
              // Escape any existing quotes in the content
              const escapedValue = variableValue.replace(/"/g, '\\"')
              variableValue = `"${escapedValue}"`
            }
          }

          set((state) => ({
            variables: {
              ...state.variables,
              [id]: {
                id,
                workflowId: variable.workflowId,
                name: uniqueName,
                type: variable.type,
                value: variableValue,
              },
            },
          }))

          // Auto-save to DB
          get().saveVariables(variable.workflowId)

          return id
        },

        updateVariable: (id, update) => {
          set((state) => {
            if (!state.variables[id]) return state

            // If name is being updated, ensure it's unique
            if (update.name !== undefined) {
              const oldVariable = state.variables[id]
              const oldVariableName = oldVariable.name
              const workflowId = oldVariable.workflowId
              const workflowVariables = Object.values(state.variables).filter(
                (v) => v.workflowId === workflowId && v.id !== id
              )

              let uniqueName = update.name
              let nameIndex = 1

              // Check if name already exists in this workflow
              while (workflowVariables.some((v) => v.name === uniqueName)) {
                uniqueName = `${update.name} (${nameIndex})`
                nameIndex++
              }

              // Always update references in subblocks when name changes, even if empty
              // This ensures references are updated even when name is completely cleared
              if (uniqueName !== oldVariableName) {
                // Update references in subblock store
                const subBlockStore = useSubBlockStore.getState()
                const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

                if (activeWorkflowId) {
                  // Get the workflow values for the active workflow
                  const workflowValues = subBlockStore.workflowValues[activeWorkflowId] || {}
                  const updatedWorkflowValues = { ...workflowValues }

                  // Loop through blocks
                  Object.entries(workflowValues).forEach(([blockId, blockValues]) => {
                    // Loop through subblocks and update references
                    Object.entries(blockValues as Record<string, any>).forEach(
                      ([subBlockId, value]) => {
                        const oldVarName = oldVariableName.replace(/\s+/g, '').toLowerCase()
                        const newVarName = uniqueName.replace(/\s+/g, '').toLowerCase()
                        const regex = new RegExp(`<variable\.${oldVarName}>`, 'gi')

                        // Use a recursive function to handle all object types
                        updatedWorkflowValues[blockId][subBlockId] = updateReferences(
                          value,
                          regex,
                          `<variable.${newVarName}>`
                        )

                        // Helper function to recursively update references in any data structure
                        function updateReferences(
                          value: any,
                          regex: RegExp,
                          replacement: string
                        ): any {
                          // Handle string values
                          if (typeof value === 'string') {
                            return regex.test(value) ? value.replace(regex, replacement) : value
                          }

                          // Handle arrays
                          if (Array.isArray(value)) {
                            return value.map((item) => updateReferences(item, regex, replacement))
                          }

                          // Handle objects
                          if (value !== null && typeof value === 'object') {
                            const result = { ...value }
                            for (const key in result) {
                              result[key] = updateReferences(result[key], regex, replacement)
                            }
                            return result
                          }

                          // Return unchanged for other types
                          return value
                        }
                      }
                    )
                  })

                  // Update the subblock store with the new values
                  useSubBlockStore.setState({
                    workflowValues: {
                      ...subBlockStore.workflowValues,
                      [activeWorkflowId]: updatedWorkflowValues,
                    },
                  })
                }
              }

              // Update with unique name
              update = { ...update, name: uniqueName }
            }

            // Auto-add quotes for string values if they aren't already quoted
            if (
              update.value !== undefined &&
              state.variables[id].type === 'string' &&
              typeof update.value === 'string' &&
              update.value.trim() !== ''
            ) {
              // Only add quotes if not already properly quoted
              const trimmedValue = update.value.trim()

              // Check if entire string is already properly quoted
              const isAlreadyQuoted =
                (trimmedValue.startsWith('"') &&
                  trimmedValue.endsWith('"') &&
                  trimmedValue.length >= 2) ||
                (trimmedValue.startsWith("'") &&
                  trimmedValue.endsWith("'") &&
                  trimmedValue.length >= 2)

              if (!isAlreadyQuoted) {
                // Escape any existing quotes in the content
                const escapedValue = update.value.replace(/"/g, '\\"')
                update = { ...update, value: `"${escapedValue}"` }
              }
            }

            const updated = {
              ...state.variables,
              [id]: {
                ...state.variables[id],
                ...update,
              },
            }

            // Debounced auto-save to DB
            const workflowId = state.variables[id].workflowId

            // Clear existing timer for this workflow if it exists
            if (saveTimers.has(workflowId)) {
              clearTimeout(saveTimers.get(workflowId))
            }

            // Set new debounced save timer
            const timer = setTimeout(() => {
              get().saveVariables(workflowId)
              saveTimers.delete(workflowId)
            }, SAVE_DEBOUNCE_DELAY)

            saveTimers.set(workflowId, timer)

            return { variables: updated }
          })
        },

        deleteVariable: (id) => {
          set((state) => {
            if (!state.variables[id]) return state

            const workflowId = state.variables[id].workflowId
            const { [id]: _, ...rest } = state.variables

            // Auto-save to DB - no debounce for deletion
            setTimeout(() => get().saveVariables(workflowId), 0)

            return { variables: rest }
          })
        },

        duplicateVariable: (id) => {
          const state = get()
          if (!state.variables[id]) return ''

          const variable = state.variables[id]
          const newId = crypto.randomUUID()

          // Ensure the duplicated name is unique
          const workflowVariables = get().getVariablesByWorkflowId(variable.workflowId)
          let baseName = `${variable.name} (copy)`
          let uniqueName = baseName
          let nameIndex = 1

          // Check if name already exists in this workflow
          while (workflowVariables.some((v) => v.name === uniqueName)) {
            uniqueName = `${baseName} (${nameIndex})`
            nameIndex++
          }

          set((state) => ({
            variables: {
              ...state.variables,
              [newId]: {
                id: newId,
                workflowId: variable.workflowId,
                name: uniqueName,
                type: variable.type,
                value: variable.value,
              },
            },
          }))

          // Auto-save to DB
          get().saveVariables(variable.workflowId)

          return newId
        },

        loadVariables: async (workflowId) => {
          // Skip if already loaded to prevent redundant API calls
          if (loadedWorkflows.has(workflowId)) return

          try {
            set({ isLoading: true, error: null })

            const response = await fetch(`${API_ENDPOINTS.WORKFLOWS}/${workflowId}/variables`)

            // Handle 404 workflow not found gracefully
            if (response.status === 404) {
              logger.info(`No variables found for workflow ${workflowId}, initializing empty set`)
              set((state) => {
                // Keep variables from other workflows
                const otherVariables = Object.values(state.variables).reduce(
                  (acc, variable) => {
                    if (variable.workflowId !== workflowId) {
                      acc[variable.id] = variable
                    }
                    return acc
                  },
                  {} as Record<string, Variable>
                )

                // Mark this workflow as loaded to prevent further attempts
                loadedWorkflows.add(workflowId)

                return {
                  variables: otherVariables,
                  isLoading: false,
                }
              })
              return
            }

            if (!response.ok) {
              throw new Error(`Failed to load workflow variables: ${response.statusText}`)
            }

            const { data } = await response.json()

            if (data && typeof data === 'object') {
              set((state) => {
                // Merge with existing variables from other workflows
                const otherVariables = Object.values(state.variables).reduce(
                  (acc, variable) => {
                    if (variable.workflowId !== workflowId) {
                      acc[variable.id] = variable
                    }
                    return acc
                  },
                  {} as Record<string, Variable>
                )

                // Mark this workflow as loaded
                loadedWorkflows.add(workflowId)

                return {
                  variables: { ...otherVariables, ...data },
                  isLoading: false,
                }
              })
            } else {
              set((state) => {
                // Keep variables from other workflows
                const otherVariables = Object.values(state.variables).reduce(
                  (acc, variable) => {
                    if (variable.workflowId !== workflowId) {
                      acc[variable.id] = variable
                    }
                    return acc
                  },
                  {} as Record<string, Variable>
                )

                // Mark this workflow as loaded
                loadedWorkflows.add(workflowId)

                return {
                  variables: otherVariables,
                  isLoading: false,
                }
              })
            }
          } catch (error) {
            logger.error('Error loading workflow variables:', { error, workflowId })
            set({
              error: error instanceof Error ? error.message : 'Unknown error',
              isLoading: false,
            })
          }
        },

        saveVariables: async (workflowId) => {
          try {
            // Skip if workflow doesn't exist in the registry
            const workflowExists = useWorkflowRegistry.getState().workflows[workflowId]
            if (!workflowExists) {
              logger.info(`Skipping variable save for non-existent workflow: ${workflowId}`)
              return
            }

            set({ isLoading: true, error: null })

            // Get only variables for this workflow
            const workflowVariables = Object.values(get().variables).filter(
              (variable) => variable.workflowId === workflowId
            )

            // Send to DB
            const response = await fetch(`${API_ENDPOINTS.WORKFLOWS}/${workflowId}/variables`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                variables: workflowVariables,
              }),
            })

            // Handle 404 workflow not found gracefully
            if (response.status === 404) {
              logger.info(
                `Cannot save variables - workflow ${workflowId} not found in database yet`
              )
              // Reset loading state but don't treat as error
              set({ isLoading: false })
              return
            }

            if (!response.ok) {
              throw new Error(`Failed to save workflow variables: ${response.statusText}`)
            }

            set({ isLoading: false })
          } catch (error) {
            logger.error('Error saving workflow variables:', { error, workflowId })
            set({
              error: error instanceof Error ? error.message : 'Unknown error',
              isLoading: false,
            })

            // Reload from DB to ensure consistency
            // Reset tracking to force a reload
            loadedWorkflows.delete(workflowId)
            get().loadVariables(workflowId)
          }
        },

        getVariablesByWorkflowId: (workflowId) => {
          return Object.values(get().variables).filter(
            (variable) => variable.workflowId === workflowId
          )
        },

        // Reset the loaded workflow tracking
        resetLoaded: () => {
          loadedWorkflows.clear()
        },
      }),
      {
        name: 'variables-store',
      }
    )
  )
)
