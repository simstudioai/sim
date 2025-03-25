import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { Variable, VariablesStore } from './types'

export const useVariablesStore = create<VariablesStore>()(
  devtools(
    persist(
      (set, get) => ({
        variables: {},
        isCreating: false,
        isEditing: null,

        addVariable: (variable) => {
          const id = crypto.randomUUID()
          const now = new Date().toISOString()
          
          set((state) => ({
            variables: {
              ...state.variables,
              [id]: {
                ...variable,
                id,
                createdAt: now,
                updatedAt: now,
              },
            },
            isCreating: false,
          }))
          
          return id
        },

        updateVariable: (id, updates) => {
          set((state) => {
            const variable = state.variables[id]
            if (!variable) return state

            return {
              variables: {
                ...state.variables,
                [id]: {
                  ...variable,
                  ...updates,
                  updatedAt: new Date().toISOString(),
                },
              },
              isEditing: null,
            }
          })
        },

        deleteVariable: (id) => {
          set((state) => {
            const newVariables = { ...state.variables }
            delete newVariables[id]
            
            return {
              variables: newVariables,
              isEditing: state.isEditing === id ? null : state.isEditing,
            }
          })
        },

        duplicateVariable: (id) => {
          const variable = get().variables[id]
          if (!variable) return ''

          const duplicateName = `${variable.name} (copy)`
          
          return get().addVariable({
            name: duplicateName,
            type: variable.type,
            value: variable.value,
            description: variable.description,
            workflowId: variable.workflowId,
          })
        },

        setIsCreating: (isCreating) => {
          set({ isCreating })
        },

        setIsEditing: (id) => {
          set({ isEditing: id })
        },

        getVariablesByWorkflowId: (workflowId) => {
          return Object.values(get().variables).filter(
            (variable) => variable.workflowId === workflowId
          )
        },
      }),
      {
        name: 'variables-store',
      }
    )
  )
)
