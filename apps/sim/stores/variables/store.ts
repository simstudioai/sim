import { v4 as uuidv4 } from 'uuid'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type {
  Variable,
  VariablesDimensions,
  VariablesPosition,
  VariablesStore,
  VariableType,
} from './types'

const logger = createLogger('VariablesModalStore')

/**
 * Floating variables modal default dimensions.
 * Matches the chat modal baseline for visual consistency.
 */
const DEFAULT_WIDTH = 250
const DEFAULT_HEIGHT = 286

/**
 * Minimum and maximum modal dimensions.
 * Kept in sync with the chat modal experience.
 */
export const MIN_VARIABLES_WIDTH = DEFAULT_WIDTH
export const MIN_VARIABLES_HEIGHT = DEFAULT_HEIGHT
export const MAX_VARIABLES_WIDTH = 500
export const MAX_VARIABLES_HEIGHT = 600

/**
 * Compute a center-biased default position, factoring in current layout chrome
 * (sidebar, right panel, and terminal), mirroring the chat modal behavior.
 */
const calculateDefaultPosition = (): VariablesPosition => {
  if (typeof window === 'undefined') {
    return { x: 100, y: 100 }
  }

  const sidebarWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
  )
  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
  const terminalHeight = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )

  const availableWidth = window.innerWidth - sidebarWidth - panelWidth
  const availableHeight = window.innerHeight - terminalHeight
  const x = sidebarWidth + (availableWidth - DEFAULT_WIDTH) / 2
  const y = (availableHeight - DEFAULT_HEIGHT) / 2
  return { x, y }
}

/**
 * Constrain a position to the visible canvas, considering layout chrome.
 */
const constrainPosition = (
  position: VariablesPosition,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT
): VariablesPosition => {
  if (typeof window === 'undefined') return position

  const sidebarWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width') || '0'
  )
  const panelWidth = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--panel-width') || '0'
  )
  const terminalHeight = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--terminal-height') || '0'
  )

  const minX = sidebarWidth
  const maxX = window.innerWidth - panelWidth - width
  const minY = 0
  const maxY = window.innerHeight - terminalHeight - height

  return {
    x: Math.max(minX, Math.min(maxX, position.x)),
    y: Math.max(minY, Math.min(maxY, position.y)),
  }
}

/**
 * Return a valid, constrained position. If the stored one is off-bounds due to
 * layout changes, prefer a fresh default center position.
 */
export const getVariablesPosition = (
  stored: VariablesPosition | null,
  width: number = DEFAULT_WIDTH,
  height: number = DEFAULT_HEIGHT
): VariablesPosition => {
  if (!stored) return calculateDefaultPosition()
  const constrained = constrainPosition(stored, width, height)
  const deltaX = Math.abs(constrained.x - stored.x)
  const deltaY = Math.abs(constrained.y - stored.y)
  if (deltaX > 100 || deltaY > 100) return calculateDefaultPosition()
  return constrained
}

/**
 * Validate a variable's value given its type. Returns an error message or undefined.
 */
function validateVariable(variable: Variable): string | undefined {
  try {
    switch (variable.type) {
      case 'number': {
        return Number.isNaN(Number(variable.value)) ? 'Not a valid number' : undefined
      }
      case 'boolean': {
        return !/^(true|false)$/i.test(String(variable.value).trim())
          ? 'Expected "true" or "false"'
          : undefined
      }
      case 'object': {
        try {
          const valueToEvaluate = String(variable.value).trim()
          if (!valueToEvaluate.startsWith('{') || !valueToEvaluate.endsWith('}')) {
            return 'Not a valid object format'
          }
          // eslint-disable-next-line no-new-func
          const parsed = new Function(`return ${valueToEvaluate}`)()
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return 'Not a valid object'
          }
          return undefined
        } catch (e) {
          logger.error('Object parsing error:', e)
          return 'Invalid object syntax'
        }
      }
      case 'array': {
        try {
          const parsed = JSON.parse(String(variable.value))
          if (!Array.isArray(parsed)) {
            return 'Not a valid JSON array'
          }
        } catch {
          return 'Invalid JSON array syntax'
        }
        return undefined
      }
      default:
        return undefined
    }
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid format'
  }
}

/**
 * Migrate deprecated type 'string' -> 'plain'.
 */
function migrateStringToPlain(variable: Variable): Variable {
  if (variable.type !== 'string') return variable
  return { ...variable, type: 'plain' as const }
}

/**
 * Floating Variables modal + Variables data store.
 */
export const useVariablesStore = create<VariablesStore>()(
  devtools(
    persist(
      (set, get) => ({
        // UI
        isOpen: false,
        position: null,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,

        setIsOpen: (open) => set({ isOpen: open }),
        setPosition: (position) => set({ position }),
        setDimensions: (dimensions) =>
          set({
            width: Math.max(MIN_VARIABLES_WIDTH, Math.min(MAX_VARIABLES_WIDTH, dimensions.width)),
            height: Math.max(
              MIN_VARIABLES_HEIGHT,
              Math.min(MAX_VARIABLES_HEIGHT, dimensions.height)
            ),
          }),
        resetPosition: () => set({ position: null }),

        // Data
        variables: {},
        isLoading: false,
        error: null,

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
            // Migrate any deprecated types and merge into store (remove other workflow entries)
            const migrated: Record<string, Variable> = Object.fromEntries(
              Object.entries(variables).map(([id, v]) => [id, migrateStringToPlain(v)])
            )
            set((state) => {
              const withoutThisWorkflow = Object.fromEntries(
                Object.entries(state.variables).filter(
                  (entry): entry is [string, Variable] => entry[1].workflowId !== workflowId
                )
              )
              return {
                variables: { ...withoutThisWorkflow, ...migrated },
                isLoading: false,
                error: null,
              }
            })
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Unknown error'
            set({ isLoading: false, error: message })
          }
        },

        addVariable: (variable, providedId) => {
          const id = providedId || uuidv4()
          const state = get()

          const workflowVariables = state
            .getVariablesByWorkflowId(variable.workflowId)
            .map((v) => ({ id: v.id, name: v.name }))

          // Default naming: variableN
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

          // Ensure uniqueness
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
            value: variable.value ?? '',
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
            const existing = state.variables[id]
            if (!existing) return state

            // Handle name changes: keep references in sync across workflow values
            if (update.name !== undefined) {
              const oldVariableName = existing.name
              const newName = String(update.name).trim()

              if (!newName) {
                update = { ...update, name: undefined }
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
                        const regex = new RegExp(`<variable\\.${oldVarName}>`, 'gi')

                        updatedWorkflowValues[blockId][subBlockId] = updateReferences(
                          value,
                          regex,
                          `<variable.${newVarName}>`
                        )

                        function updateReferences(
                          val: any,
                          refRegex: RegExp,
                          replacement: string
                        ): any {
                          if (typeof val === 'string') {
                            return refRegex.test(val) ? val.replace(refRegex, replacement) : val
                          }
                          if (Array.isArray(val)) {
                            return val.map((item) => updateReferences(item, refRegex, replacement))
                          }
                          if (val !== null && typeof val === 'object') {
                            const result: Record<string, any> = { ...val }
                            for (const key in result) {
                              result[key] = updateReferences(result[key], refRegex, replacement)
                            }
                            return result
                          }
                          return val
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

            // Handle deprecated -> new type migration
            if (update.type === 'string') {
              update = { ...update, type: 'plain' as VariableType }
            }

            const updated: Variable = {
              ...existing,
              ...update,
              validationError: undefined,
            }

            // Validate only when type or value changed
            if (update.type || update.value !== undefined) {
              updated.validationError = validateVariable(updated)
            }

            return {
              variables: {
                ...state.variables,
                [id]: updated,
              },
            }
          })
        },

        deleteVariable: (id) => {
          set((state) => {
            if (!state.variables[id]) return state
            const { [id]: _deleted, ...rest } = state.variables
            return { variables: rest }
          })
        },

        duplicateVariable: (id, providedId) => {
          const state = get()
          const existing = state.variables[id]
          if (!existing) return ''
          const newId = providedId || uuidv4()

          const workflowVariables = state.getVariablesByWorkflowId(existing.workflowId)
          const baseName = `${existing.name} (copy)`
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
                workflowId: existing.workflowId,
                name: uniqueName,
                type: existing.type,
                value: existing.value,
              },
            },
          }))

          return newId
        },

        getVariablesByWorkflowId: (workflowId) => {
          return Object.values(get().variables).filter((v) => v.workflowId === workflowId)
        },
      }),
      {
        name: 'variables-modal-store',
      }
    )
  )
)

/**
 * Get default floating variables modal dimensions.
 */
export const getDefaultVariablesDimensions = (): VariablesDimensions => ({
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
})
