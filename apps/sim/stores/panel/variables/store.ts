import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import type { Variable, VariablesStore } from '@/stores/panel/variables/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

const logger = createLogger('VariablesStore')

function validateVariable(variable: Variable): string | undefined {
  try {
    switch (variable.type) {
      case 'number':
        if (Number.isNaN(Number(variable.value))) {
          return 'Not a valid number'
        }
        break
      case 'boolean':
        if (!/^(true|false)$/i.test(String(variable.value).trim())) {
          return 'Expected "true" or "false"'
        }
        break
      case 'object':
        try {
          const valueToEvaluate = String(variable.value).trim()

          if (!valueToEvaluate.startsWith('{') || !valueToEvaluate.endsWith('}')) {
            return 'Not a valid object format'
          }

          const parsed = new Function(`return ${valueToEvaluate}`)()

          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return 'Not a valid object'
          }

          return undefined
        } catch (e) {
          logger.error('Object parsing error:', e)
          return 'Invalid object syntax'
        }
      case 'array':
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

function migrateStringToPlain(variable: Variable): Variable {
  if (variable.type !== 'string') {
    return variable
  }

  const updated = {
    ...variable,
    type: 'plain' as const,
  }

  return updated
}

export const useVariablesStore = create<VariablesStore>()(
  devtools((set, get) => ({
    variables: {},
    isLoading: false,
    error: null,
    isEditing: null,

    async loadForWorkflow(workflowId) {
      try {
        set({ isLoading: true, error: null })
        const res = await fetch(`/api/workflows/${workflowId}/variables`, { method: 'GET' })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text || `Failed to load variables: ${res.statusText}`)
        }
        const data = await res.json()
        const variables = (data?.data as Record<string, Variable>) || {}
        set((state) => {
          const withoutWorkflow = Object.fromEntries(
            Object.entries(state.variables).filter(
              (entry): entry is [string, Variable] => entry[1].workflowId !== workflowId
            )
          )
          return {
            variables: { ...withoutWorkflow, ...variables },
            isLoading: false,
            error: null,
          }
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        set({ isLoading: false, error: message })
      }
    },

    addVariable: (variable, providedId?: string) => {
      const id = providedId || crypto.randomUUID()

      const workflowVariables = get().getVariablesByWorkflowId(variable.workflowId)

      if (!variable.name || /^variable\d+$/.test(variable.name)) {
        const existingNumbers = workflowVariables
          .map((v) => {
            const match = v.name.match(/^variable(\d+)$/)
            return match ? Number.parseInt(match[1]) : 0
          })
          .filter((n) => !Number.isNaN(n))

        const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1

        variable.name = `variable${nextNumber}`
      }

      let uniqueName = variable.name
      let nameIndex = 1

      while (workflowVariables.some((v) => v.name === uniqueName)) {
        uniqueName = `${variable.name} (${nameIndex})`
        nameIndex++
      }

      if (variable.type === 'string') {
        variable.type = 'plain'
      }

      const newVariable: Variable = {
        id,
        workflowId: variable.workflowId,
        name: uniqueName,
        type: variable.type,
        value: variable.value || '',
        validationError: undefined,
      }

      const validationError = validateVariable(newVariable)
      if (validationError) {
        newVariable.validationError = validationError
      }

      set((state) => ({
        variables: {
          ...state.variables,
          [id]: newVariable,
        },
      }))

      return id
    },

    updateVariable: (id, update) => {
      set((state) => {
        if (!state.variables[id]) return state

        if (update.name !== undefined) {
          const oldVariable = state.variables[id]
          const oldVariableName = oldVariable.name
          const newName = update.name.trim()

          if (!newName) {
            update = { ...update }
            update.name = undefined
          } else if (newName !== oldVariableName) {
            const subBlockStore = useSubBlockStore.getState()
            const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId

            if (activeWorkflowId) {
              const workflowValues = subBlockStore.workflowValues[activeWorkflowId] || {}
              const updatedWorkflowValues = { ...workflowValues }

              Object.entries(workflowValues).forEach(([blockId, blockValues]) => {
                Object.entries(blockValues as Record<string, any>).forEach(
                  ([subBlockId, value]) => {
                    const oldVarName = oldVariableName.replace(/\s+/g, '').toLowerCase()
                    const newVarName = newName.replace(/\s+/g, '').toLowerCase()
                    const regex = new RegExp(`<variable\.${oldVarName}>`, 'gi')

                    updatedWorkflowValues[blockId][subBlockId] = updateReferences(
                      value,
                      regex,
                      `<variable.${newVarName}>`
                    )

                    function updateReferences(value: any, regex: RegExp, replacement: string): any {
                      if (typeof value === 'string') {
                        return regex.test(value) ? value.replace(regex, replacement) : value
                      }

                      if (Array.isArray(value)) {
                        return value.map((item) => updateReferences(item, regex, replacement))
                      }

                      if (value !== null && typeof value === 'object') {
                        const result = { ...value }
                        for (const key in result) {
                          result[key] = updateReferences(result[key], regex, replacement)
                        }
                        return result
                      }

                      return value
                    }
                  }
                )
              })

              useSubBlockStore.setState({
                workflowValues: {
                  ...subBlockStore.workflowValues,
                  [activeWorkflowId]: updatedWorkflowValues,
                },
              })
            }
          }
        }

        if (update.type === 'string') {
          update = { ...update, type: 'plain' }
        }

        const updatedVariable: Variable = {
          ...state.variables[id],
          ...update,
          validationError: undefined,
        }

        if (update.type || update.value !== undefined) {
          updatedVariable.validationError = validateVariable(updatedVariable)
        }

        const updated = {
          ...state.variables,
          [id]: updatedVariable,
        }

        return { variables: updated }
      })
    },

    deleteVariable: (id) => {
      set((state) => {
        if (!state.variables[id]) return state

        const workflowId = state.variables[id].workflowId
        const { [id]: _, ...rest } = state.variables

        return { variables: rest }
      })
    },

    duplicateVariable: (id, providedId?: string) => {
      const state = get()
      if (!state.variables[id]) return ''

      const variable = state.variables[id]
      const newId = providedId || crypto.randomUUID()

      const workflowVariables = get().getVariablesByWorkflowId(variable.workflowId)
      const baseName = `${variable.name} (copy)`
      let uniqueName = baseName
      let nameIndex = 1

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

      return newId
    },

    getVariablesByWorkflowId: (workflowId) => {
      return Object.values(get().variables).filter((variable) => variable.workflowId === workflowId)
    },
  }))
)
