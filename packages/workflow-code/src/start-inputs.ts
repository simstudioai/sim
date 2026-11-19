/**
 * A workflow's inputs: the fields its Start trigger's `inputFormat` declares, which a child
 * workflow call's `inputMapping` fills and a run's input carries.
 */
import { isRecordLike } from '@sim/utils/object'
import type { CanonicalWorkflow } from './model'

/**
 * The trigger types whose `inputFormat` defines a workflow's inputs. Webhook and schedule
 * triggers are not among them: they receive an external payload, not a caller's inputs.
 */
export const INPUT_TRIGGER_TYPES = [
  'starter',
  'start',
  'start_trigger',
  'api_trigger',
  'input_trigger',
] as const

/** One declared input: its name and its `inputFormat` type (`string`, `number`, …). */
export interface WorkflowInput {
  name: string
  type: string
}

/**
 * The inputs the first input trigger of `workflow` declares, in order; `null` when the workflow
 * has no input trigger, so a caller cannot map inputs into it.
 */
export function startInputs(workflow: CanonicalWorkflow): WorkflowInput[] | null {
  const start = Object.values(workflow.blocks).find((block) =>
    INPUT_TRIGGER_TYPES.some((type) => type === block.type)
  )
  if (!start) return null
  const format = start.params.inputFormat
  if (format?.kind !== 'value' || !Array.isArray(format.value)) return []
  return format.value.flatMap((field) => {
    if (!isRecordLike(field) || typeof field.name !== 'string' || field.name === '') return []
    return [{ name: field.name, type: typeof field.type === 'string' ? field.type : 'string' }]
  })
}
