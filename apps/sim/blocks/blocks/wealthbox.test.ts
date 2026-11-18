import { describe, expect, it } from 'vitest'
import { WealthboxBlock } from '@/blocks/blocks/wealthbox'
import { wealthboxReadNoteTool } from '@/tools/wealthbox/read_note'
import { wealthboxWriteTaskTool } from '@/tools/wealthbox/write_task'

function mapParams(params: Record<string, unknown>, context?: { operation: string }) {
  const mapper = WealthboxBlock.tools.config?.params
  if (!mapper) throw new Error('Wealthbox block has no params mapper')
  return { ...params, ...mapper(params, context) }
}

function taskBody(params: Record<string, unknown>) {
  const body = wealthboxWriteTaskTool.request.body
  if (!body) throw new Error('Write task tool has no request body')
  const optionalString = (value: unknown) => (typeof value === 'string' ? value : undefined)
  return body({
    accessToken: 'token',
    operation: 'write_task',
    title: optionalString(params.title),
    dueDate: optionalString(params.dueDate),
    description: optionalString(params.description),
    contactId: optionalString(params.contactId),
  })
}

describe('Wealthbox Write Task', () => {
  it('sends the block Content field as the task description', () => {
    const params = mapParams({
      operation: 'write_task',
      oauthCredential: 'cred',
      title: 'Call client',
      dueDate: '2026-01-05 11:00 AM -0500',
      content: 'Review the portfolio',
      contactId: '42',
    })

    expect(taskBody(params)).toMatchObject({
      name: 'Call client',
      description: 'Review the portfolio',
      linked_to: [{ id: 42, type: 'Contact' }],
    })
  })

  it('keeps the model description on an agent tool call', () => {
    const params = mapParams(
      {
        oauthCredential: 'cred',
        title: 'Call client',
        dueDate: '2026-01-05 11:00 AM -0500',
        description: 'From the model',
      },
      { operation: 'write_task' }
    )

    expect(taskBody(params)).toMatchObject({ description: 'From the model' })
  })
})

describe('Wealthbox Read Note without a note ID', () => {
  it('returns the listed notes from the status_updates array', async () => {
    const transform = wealthboxReadNoteTool.transformResponse
    if (!transform) throw new Error('Read note tool has no transformResponse')

    const notes = [{ id: 1, content: 'Spoke with the client' }]
    const result = await transform(Response.json({ status_updates: notes }))

    expect(result.output).toMatchObject({ notes, metadata: { totalItems: 1 } })
  })
})
