import type { ApiStartField } from '@/lib/interfaces/spec/api-start-input'
import {
  type InterfaceControl,
  type InterfaceSpec,
  interfaceSpecSchema,
} from '@/lib/interfaces/spec/schema'
import { flattenWorkflowOutputs } from '@/lib/workflows/blocks/flatten-outputs'

export interface OutputConfig {
  blockId: string
  path: string
}

export interface ValidateInterfaceSpecResult {
  success: boolean
  spec?: InterfaceSpec
  error?: string
}

const CONTROL_TYPE_COMPAT: Record<string, Set<string>> = {
  text: new Set(['string']),
  textarea: new Set(['string']),
  number: new Set(['number']),
  select: new Set(['string']),
  checkbox: new Set(['boolean']),
}

function isBoundControl(
  control: InterfaceControl
): control is Extract<InterfaceControl, { bind: string }> {
  return control.type !== 'markdown'
}

/**
 * Parse and validate an InterfaceSpec against API start fields (and optional outputs).
 * Mutates the parsed spec to normalize required flags and fieldMapping from binds.
 */
export function validateInterfaceSpec(
  raw: unknown,
  fields: ApiStartField[],
  options?: {
    outputConfigs?: OutputConfig[]
    blocks?: Record<
      string,
      {
        id?: string
        type: string
        name?: string
        triggerMode?: boolean
        subBlocks?: Record<string, unknown>
      }
    >
    edges?: Array<{ source: string; target: string }>
  }
): ValidateInterfaceSpecResult {
  const parsed = interfaceSpecSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid interface spec',
    }
  }

  const spec = parsed.data
  const fieldByName = new Map(fields.map((f) => [f.name, f]))
  const controlIds = new Set<string>()
  const boundFields = new Map<string, string>()

  for (const section of spec.sections) {
    for (const control of section.controls) {
      if (controlIds.has(control.id)) {
        return { success: false, error: `Duplicate control id "${control.id}"` }
      }
      controlIds.add(control.id)

      if (!isBoundControl(control)) continue

      const field = fieldByName.get(control.bind)
      if (!field) {
        return {
          success: false,
          error: `Control "${control.id}" binds to unknown field "${control.bind}"`,
        }
      }

      const allowed = CONTROL_TYPE_COMPAT[control.type]
      if (allowed && !allowed.has(field.type)) {
        return {
          success: false,
          error: `Control "${control.id}" type "${control.type}" is incompatible with field type "${field.type}"`,
        }
      }

      // Always mirror API schema requiredness (including clearing incorrect LLM flags)
      control.required = field.required

      if (field.required) {
        if (boundFields.has(control.bind)) {
          return {
            success: false,
            error: `Required field "${control.bind}" is bound more than once`,
          }
        }
        boundFields.set(control.bind, control.id)
      } else if (!boundFields.has(control.bind)) {
        boundFields.set(control.bind, control.id)
      }

      if (control.type === 'select') {
        const values = new Set(control.options.map((o) => o.value))
        if (values.size !== control.options.length) {
          return { success: false, error: `Select "${control.id}" has duplicate option values` }
        }
      }
    }
  }

  for (const field of fields) {
    if (field.required && !boundFields.has(field.name)) {
      return {
        success: false,
        error: `Required field "${field.name}" is not bound by any control`,
      }
    }
  }

  const action = spec.actions[0]
  if (!action) {
    return { success: false, error: 'Interface requires exactly one action' }
  }

  // Derive fieldMapping strictly from binds so remaps cannot drop required fields
  const derivedMapping: Record<string, string> = {}
  for (const section of spec.sections) {
    for (const control of section.controls) {
      if (!isBoundControl(control)) continue
      derivedMapping[control.id] = control.bind
    }
  }
  action.submit.fieldMapping = derivedMapping

  if (options?.outputConfigs?.length && options.blocks) {
    const flattened = flattenWorkflowOutputs(
      Object.entries(options.blocks).map(([id, block]) => ({
        id: block.id || id,
        type: block.type,
        name: block.name,
        triggerMode: block.triggerMode,
        subBlocks: block.subBlocks,
      })),
      options.edges
    )
    const validKeys = new Set(flattened.map((o) => `${o.blockId}::${o.path}`))
    for (const config of options.outputConfigs) {
      const key = `${config.blockId}::${config.path}`
      if (!validKeys.has(key)) {
        return {
          success: false,
          error: `Unknown output config ${config.blockId}.${config.path}`,
        }
      }
    }
  }

  return { success: true, spec }
}

/**
 * Reject workflows that pause for human input. In-process `wait` delays are allowed.
 */
export function workflowHasHitlBlocks(blocks: Record<string, { type: string }>): boolean {
  return Object.values(blocks).some((block) => block.type === 'human_in_the_loop')
}
