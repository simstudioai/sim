import { describe, expect, it } from 'vitest'
import type {
  PipedriveUpdateActivityParams,
  PipedriveUpdateLeadParams,
} from '@/tools/pipedrive/types'
import { pipedriveUpdateActivityTool } from '@/tools/pipedrive/update_activity'
import { pipedriveUpdateLeadTool } from '@/tools/pipedrive/update_lead'

function activityBody(params: Record<string, unknown>) {
  const build = pipedriveUpdateActivityTool.request.body
  if (!build) throw new Error('update activity must build a body')
  return build({ accessToken: 't', activity_id: '1', ...params } as PipedriveUpdateActivityParams)
}

function leadBody(params: Record<string, unknown>) {
  const build = pipedriveUpdateLeadTool.request.body
  if (!build) throw new Error('update lead must build a body')
  return build({ accessToken: 't', lead_id: 'l-1', ...params } as PipedriveUpdateLeadParams)
}

describe('Pipedrive update operations leave unchosen fields alone', () => {
  it('does not mark an activity not done when Mark as Done is left on No change', () => {
    expect(activityBody({ subject: 'Call', done: '' })).not.toHaveProperty('done')
  })

  it('sends an explicit done choice', () => {
    expect(activityBody({ done: '1' })).toHaveProperty('done', true)
    expect(activityBody({ done: '0' })).toHaveProperty('done', false)
  })

  it('does not unarchive a lead when Archive Lead is left on No change', () => {
    expect(leadBody({ title: 'Lead', is_archived: '' })).not.toHaveProperty('is_archived')
  })
})
