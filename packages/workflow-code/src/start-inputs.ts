/**
 * A workflow's inputs: the fields its Start trigger's `inputFormat` declares, which a child
 * workflow call's `inputMapping` fills and a run's input carries.
 */
import { isRecordLike } from '@sim/utils/object'
import type { CanonicalParam, CanonicalWorkflow } from './model'

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
  return inputFormatFields(start.params.inputFormat) ?? []
}

/**
 * The fields an `inputFormat` param declares, in order: `[]` when it is absent, `null` when its
 * value is not a list (a reference or other text), so nothing can be said about its fields.
 */
export function inputFormatFields(param: CanonicalParam | undefined): WorkflowInput[] | null {
  if (param === undefined) return []
  if (param.kind !== 'value' || !Array.isArray(param.value)) return null
  return param.value.flatMap((field) => {
    if (!isRecordLike(field) || typeof field.name !== 'string' || field.name === '') return []
    return [{ name: field.name, type: typeof field.type === 'string' ? field.type : 'string' }]
  })
}
