import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console-logger'
import { devtools, persist } from 'zustand/middleware'
import { Variable, VariablesStore } from './types'
import { API_ENDPOINTS } from '@/stores/constants'

const logger = createLogger('Variables Store')

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
          
          set((state) => ({
            variables: {
              ...state.variables,
              [id]: {
                ...variable,
                id,
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

            const updated = {
              ...state.variables,
              [id]: {
                ...state.variables[id],
                ...update,
              },
            }

            // Auto-save to DB
            const workflowId = state.variables[id].workflowId
            setTimeout(() => get().saveVariables(workflowId), 0)

            return { variables: updated }
          })
        },

        deleteVariable: (id) => {
          set((state) => {
            if (!state.variables[id]) return state

            const workflowId = state.variables[id].workflowId
            const { [id]: _, ...rest } = state.variables

            // Auto-save to DB
            setTimeout(() => get().saveVariables(workflowId), 0)

            return { variables: rest }
          })
        },

        duplicateVariable: (id) => {
          const state = get()
          if (!state.variables[id]) return ''

          const variable = state.variables[id]
          const newId = crypto.randomUUID()

          set((state) => ({
            variables: {
              ...state.variables,
              [newId]: {
                ...variable,
                id: newId,
                name: `${variable.name} (copy)`,
              },
            },
          }))

          // Auto-save to DB
          get().saveVariables(variable.workflowId)

          return newId
        },

        loadVariables: async (workflowId) => {
          try {
            set({ isLoading: true, error: null })

            const response = await fetch(`${API_ENDPOINTS.WORKFLOW_VARIABLES}/${workflowId}`)

            if (!response.ok) {
              throw new Error(`Failed to load workflow variables: ${response.statusText}`)
            }

            const { data } = await response.json()

            if (data && typeof data === 'object') {
              set((state) => {
                // Merge with existing variables from other workflows
                const otherVariables = Object.values(state.variables).reduce((acc, variable) => {
                  if (variable.workflowId !== workflowId) {
                    acc[variable.id] = variable
                  }
                  return acc
                }, {} as Record<string, Variable>)

                return {
                  variables: { ...otherVariables, ...data },
                  isLoading: false,
                }
              })
            } else {
              set((state) => {
                // Keep variables from other workflows
                const otherVariables = Object.values(state.variables).reduce((acc, variable) => {
                  if (variable.workflowId !== workflowId) {
                    acc[variable.id] = variable
                  }
                  return acc
                }, {} as Record<string, Variable>)

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
            set({ isLoading: true, error: null })

            // Get only variables for this workflow
            const workflowVariables = Object.values(get().variables).filter(
              (variable) => variable.workflowId === workflowId
            )

            // Send to DB
            const response = await fetch(`${API_ENDPOINTS.WORKFLOW_VARIABLES}/${workflowId}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                variables: workflowVariables,
              }),
            })

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
            get().loadVariables(workflowId)
          }
        },

        getVariablesByWorkflowId: (workflowId) => {
          return Object.values(get().variables).filter((variable) => variable.workflowId === workflowId)
        },
      }),
      {
        name: 'variables-store',
      }
    )
  )
)
