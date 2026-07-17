import type { InterfaceSpec } from '@/lib/interfaces/spec/schema'

export interface BuildExecutePayloadResult {
  success: boolean
  payload?: Record<string, unknown>
  error?: string
}

/**
 * Build the workflow execute body from a private InterfaceSpec and client values.
 * Untouched optional controls should be omitted from `values` by the client.
 * Mapping is derived from each control's `bind` (fieldMapping is ignored if inconsistent).
 */
export function buildExecutePayload(
  spec: InterfaceSpec,
  actionId: string,
  values: Record<string, unknown>
): BuildExecutePayloadResult {
  const action = spec.actions.find((a) => a.id === actionId)
  if (!action) {
    return { success: false, error: 'Unknown action' }
  }

  const boundControls = spec.sections.flatMap((section) =>
    section.controls.filter((c) => c.type !== 'markdown')
  )
  const controlById = new Map(boundControls.map((c) => [c.id, c] as const))

  for (const controlId of Object.keys(values)) {
    if (!controlById.has(controlId)) {
      return { success: false, error: `Unknown control "${controlId}"` }
    }
  }

  for (const control of boundControls) {
    const required = control.required === true
    const value = values[control.id]
    if (required && (value === undefined || value === null || value === '')) {
      return { success: false, error: `Missing required field "${control.label}"` }
    }

    if (value === undefined) continue

    if (control.type === 'number' && typeof value !== 'number') {
      return { success: false, error: `Invalid number for "${control.label}"` }
    }
    if (control.type === 'checkbox' && typeof value !== 'boolean') {
      return { success: false, error: `Invalid checkbox value for "${control.label}"` }
    }
    if (
      (control.type === 'text' || control.type === 'textarea' || control.type === 'select') &&
      typeof value !== 'string'
    ) {
      return { success: false, error: `Invalid text value for "${control.label}"` }
    }
    if (control.type === 'select') {
      const allowed = new Set(control.options.map((o) => o.value))
      if (!allowed.has(value as string)) {
        return { success: false, error: `Invalid option for "${control.label}"` }
      }
    }
  }

  const payload: Record<string, unknown> = {}
  for (const control of boundControls) {
    if (!(control.id in values)) continue
    const value = values[control.id]
    if (value === undefined || value === null || value === '') continue
    // Always map via bind — ignore LLM remaps that could drop required fields
    payload[control.bind] = value
  }

  return { success: true, payload }
}
