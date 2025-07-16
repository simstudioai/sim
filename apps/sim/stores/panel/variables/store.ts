import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console-logger'
import { API_ENDPOINTS } from '@/stores/constants'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { Variable, VariablesStore } from './types'

const logger = createLogger('VariablesStore')
const SAVE_DEBOUNCE_DELAY = 200 // Reduced debounce for variables (not real-time collaborative)

// Map to store debounce timers for each workflow
const saveTimers = new Map<string, NodeJS.Timeout>()
// Track which workflows have already been loaded
const loadedWorkflows = new Set<string>()
// Track recently added variable IDs with timestamps
const recentlyAddedVariables = new Map<string, number>()
// Time window in ms to consider a variable as "recently added" (3 seconds)
const RECENT_VARIABLE_WINDOW = 3000

// Clear a workspace from the loaded tracking when switching workspaces
export function clearWorkflowVariablesTracking() {
  loadedWorkflows.clear()
  // Also clear any old entries from recentlyAddedVariables
  const now = Date.now()
  recentlyAddedVariables.forEach((timestamp, id) => {
    if (now - timestamp > RECENT_VARIABLE_WINDOW * 2) {
      recentlyAddedVariables.delete(id)
    }
  })
}

/**
 * Check if variable format is valid according to type without modifying it
 * Only provides validation feedback - does not change the value
 */
function validateVariable(variable: Variable): string | undefined {
  try {
    // We only care about the validation result, not the parsed value
    switch (variable.type) {
      case 'number':
        // Check if it's a valid number
        if (Number.isNaN(Number(variable.value))) {
          return 'Not a valid number'
        }
        break
      case 'boolean':
        // Check if it's a valid boolean
        if (!/^(true|false)$/i.test(String(variable.value).trim())) {
          return 'Expected "true" or "false"'
        }
        break
      case 'object':
        // Check if it's a valid JSON object
        try {
          // Handle both JavaScript and JSON syntax
          const valueToEvaluate = String(variable.value).trim()

          // Basic security check to prevent arbitrary code execution
          if (!valueToEvaluate.startsWith('{') || !valueToEvaluate.endsWith('}')) {
            return 'Not a valid object format'
          }

          // Use Function constructor to safely evaluate the object expression
          // This handles both JSON and JS object literal syntax
          const parsed = new Function(`return ${valueToEvaluate}`)()

          // Verify it's actually an object (not array or null)
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return 'Not a valid object'
          }

          return undefined // Valid object
        } catch (e) {
          console.log('Object parsing error:', e)
          return 'Invalid object syntax'
        }
      case 'array':
        // Check if it's a valid JSON array
        try {
          const parsed = JSON.parse(String(variable.value))
          if (!Array.isArray(parsed)) {
            return 'Not a valid JSON array'
          }
        } catch {
          return 'Invalid JSON array syntax'
        }
        break
    }
    return undefined
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid format'
  }
}

/**
 * Migrates a variable from 'string' type to 'plain' type
 * Handles the value conversion appropriately
 */
function migrateStringToPlain(variable: Variable): Variable {
  if (variable.type !== 'string') {
    return variable
  }

  // Convert string type to plain
  const updated = {
    ...variable,
    type: 'plain' as const,
  }

  // For plain text, we want to preserve values exactly as they are,
  // including any quote characters that may be part of the text
  return updated
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
                return match ? Number.parseInt(match[1]) : 0
              })
              .filter((n) => !Number.isNaN(n))

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

          // Check for type conversion - only for backward compatibility
          if (variable.type === 'string') {
            variable.type = 'plain'
          }

          // Create the new variable with empty value
          const newVariable: Variable = {
            id,
            workflowId: variable.workflowId,
            name: uniqueName,
            type: variable.type,
            value: variable.value || '',
            validationError: undefined,
          }

          // Check for validation errors without modifying the value
          const validationError = validateVariable(newVariable)
          if (validationError) {
            newVariable.validationError = validationError
          }

          // Mark this variable as recently added with current timestamp
          recentlyAddedVariables.set(id, Date.now())

          set((state) => ({
            variables: {
              ...state.variables,
              [id]: newVariable,
            },
          }))

          // Use the same debounced save mechanism as updateVariable
          const workflowId = variable.workflowId

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

              // Only check uniqueness for non-empty names
              // Empty names don't need to be unique as they're temporary states
              if (uniqueName.trim() !== '') {
                // Check if name already exists in this workflow
                while (workflowVariables.some((v) => v.name === uniqueName)) {
                  uniqueName = `${update.name} (${nameIndex})`
                  nameIndex++
                }
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

            // If type is being updated to 'string', convert it to 'plain' instead
            if (update.type === 'string') {
              update = { ...update, type: 'plain' }
            }

            // Create updated variable to check for validation
            const updatedVariable: Variable = {
              ...state.variables[id],
              ...update,
              validationError: undefined, // Initialize property to be updated later
            }

            // If the type or value changed, check for validation errors
            if (update.type || update.value !== undefined) {
              // Only add validation feedback - never modify the value
              updatedVariable.validationError = validateVariable(updatedVariable)
            }

            const updated = {
              ...state.variables,
              [id]: updatedVariable,
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

            // Use the same debounced save mechanism for consistency
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
          const baseName = `${variable.name} (copy)`
          let uniqueName = baseName
          let nameIndex = 1

          // Check if name already exists in this workflow
          while (workflowVariables.some((v) => v.name === uniqueName)) {
            uniqueName = `${baseName} (${nameIndex})`
            nameIndex++
          }

          // Mark this duplicated variable as recently added
          recentlyAddedVariables.set(newId, Date.now())

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

          // Use the same debounced save mechanism
          const workflowId = variable.workflowId

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

          return newId
        },

        loadVariables: async (workflowId) => {
          // Skip if already loaded to prevent redundant API calls, but ensure
          // we check for the special case of recently added variables first
          if (loadedWorkflows.has(workflowId)) {
            // Even if workflow is loaded, check if we have recent variables to protect
            const workflowVariables = Object.values(get().variables).filter(
              (v) => v.workflowId === workflowId
            )

            const now = Date.now()
            const hasRecentVariables = workflowVariables.some(
              (v) =>
                recentlyAddedVariables.has(v.id) &&
                now - (recentlyAddedVariables.get(v.id) || 0) < RECENT_VARIABLE_WINDOW
            )

            // No force reload needed if no recent variables and we've already loaded
            if (!hasRecentVariables) {
              return
            }

            // Otherwise continue and do a full load+merge to protect recent variables
          }

          try {
            set({ isLoading: true, error: null })

            const response = await fetch(`${API_ENDPOINTS.WORKFLOWS}/${workflowId}/variables`)

            // Capture current variables for this workflow before we modify anything
            const currentWorkflowVariables = Object.values(get().variables)
              .filter((v) => v.workflowId === workflowId)
              .reduce(
                (acc, v) => {
                  acc[v.id] = v
                  return acc
                },
                {} as Record<string, Variable>
              )

            // Check which variables were recently added (within the last few seconds)
            const now = Date.now()
            const protectedVariableIds = new Set<string>()

            // Identify variables that should be protected from being overwritten
            Object.keys(currentWorkflowVariables).forEach((id) => {
              // Protect recently added variables
              if (
                recentlyAddedVariables.has(id) &&
                now - (recentlyAddedVariables.get(id) || 0) < RECENT_VARIABLE_WINDOW
              ) {
                protectedVariableIds.add(id)
              }
            })

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

                // Add back protected variables that should not be removed
                Object.keys(currentWorkflowVariables).forEach((id) => {
                  if (protectedVariableIds.has(id)) {
                    otherVariables[id] = currentWorkflowVariables[id]
                  }
                })

                // Mark this workflow as loaded to prevent further attempts
                loadedWorkflows.add(workflowId)

                return {
                  variables: otherVariables,
                  isLoading: false,
                }
              })
              return
            }

            // Handle unauthorized (401) or forbidden (403) gracefully
            if (response.status === 401 || response.status === 403) {
              logger.warn(`No permission to access variables for workflow ${workflowId}`)
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

                // Mark this workflow as loaded but with access issues
                loadedWorkflows.add(workflowId)

                return {
                  variables: otherVariables,
                  isLoading: false,
                  error: 'You do not have permission to access these variables',
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
                // Migrate any 'string' type variables to 'plain'
                const migratedData: Record<string, Variable> = {}
                for (const [id, variable] of Object.entries(data)) {
                  migratedData[id] = migrateStringToPlain(variable as Variable)
                }

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

                // Create the final variables object, prioritizing protected variables
                const finalVariables = { ...otherVariables, ...migratedData }

                // Restore any protected variables that shouldn't be overwritten
                Object.keys(currentWorkflowVariables).forEach((id) => {
                  if (protectedVariableIds.has(id)) {
                    finalVariables[id] = currentWorkflowVariables[id]
                  }
                })

                // Mark this workflow as loaded
                loadedWorkflows.add(workflowId)

                return {
                  variables: finalVariables,
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

                // Add back protected variables that should not be removed
                Object.keys(currentWorkflowVariables).forEach((id) => {
                  if (protectedVariableIds.has(id)) {
                    otherVariables[id] = currentWorkflowVariables[id]
                  }
                })

                // Mark this workflow as loaded
                loadedWorkflows.add(workflowId)

                return {
                  variables: otherVariables,
                  isLoading: false,
                }
              })
            }
          } catch (error) {
            logger.error('Error loading workflow variables:', {
              error,
              workflowId,
            })
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
            logger.error('Error saving workflow variables:', {
              error,
              workflowId,
            })
            set({
              error: error instanceof Error ? error.message : 'Unknown error',
              isLoading: false,
            })

            // Don't reload variables after save error - this could cause data loss
            // Just clear the loading state
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

          // Clean up stale entries from recentlyAddedVariables
          const now = Date.now()
          recentlyAddedVariables.forEach((timestamp, id) => {
            if (now - timestamp > RECENT_VARIABLE_WINDOW * 2) {
              recentlyAddedVariables.delete(id)
            }
          })
        },
      }),
      {
        name: 'variables-store',
      }
    )
  )
)
