import { describe, expect, it } from 'vitest'
import { MicrosoftPlannerBlock } from '@/blocks/blocks/microsoft_planner'
import type { BlockToolParamsContext } from '@/blocks/types'

/** What the tool receives: the mapper's result spread over its own input, as both callers merge it. */
const forwarded = (inputs: Record<string, unknown>, context?: BlockToolParamsContext) => ({
  ...inputs,
  ...(MicrosoftPlannerBlock.tools.config?.params?.(inputs, context) ?? {}),
})

describe('MicrosoftPlannerBlock tool-call params', () => {
  it('keeps the model-supplied task id on an update', () => {
    const result = forwarded(
      { oauthCredential: 'cred', taskId: 'task-1', etag: 'W/"1"', title: 'Renamed' },
      { operation: 'update_task' }
    )

    expect(result.taskId).toBe('task-1')
  })

  it('keeps the model-supplied plan title', () => {
    const result = forwarded(
      { oauthCredential: 'cred', groupId: 'group-1', title: 'Q3 plan' },
      { operation: 'create_plan' }
    )

    expect(result.title).toBe('Q3 plan')
  })

  it('maps the stored update-task picker and forwards an object checklist', () => {
    const checklist = { 'item-1': { title: 'Review', isChecked: false } }
    const result = forwarded(
      { oauthCredential: 'cred', updateTaskId: ' task-2 ', etag: 'W/"2"', checklist },
      { operation: 'update_task_details' }
    )

    expect(result.taskId).toBe('task-2')
    expect(result.checklist).toEqual(checklist)
  })
})
