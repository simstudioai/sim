import { describe, expect, it } from 'vitest'
import { WealthboxBlock } from '@/blocks/blocks/wealthbox'
import { wealthboxReadContactTool } from '@/tools/wealthbox/read_contact'
import { wealthboxReadNoteTool } from '@/tools/wealthbox/read_note'
import { wealthboxReadTaskTool } from '@/tools/wealthbox/read_task'
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
  it('returns the listed notes and keeps the raw list body under note', async () => {
    const transform = wealthboxReadNoteTool.transformResponse
    if (!transform) throw new Error('Read note tool has no transformResponse')

    const notes = [{ id: 1, content: 'Spoke with the client' }]
    const result = await transform(Response.json({ status_updates: notes }))

    expect(result.output).toMatchObject({
      notes,
      note: { status_updates: notes },
      metadata: { totalItems: 1 },
    })
  })
})

function readUrl(
  tool: typeof wealthboxReadTaskTool,
  operation: 'read_task' | 'read_contact',
  params: Record<string, unknown>
) {
  const url = tool.request.url
  if (typeof url !== 'function') throw new Error('Read tool has no URL builder')
  const id = (value: unknown) => (typeof value === 'string' ? value : undefined)
  return url({
    accessToken: 'token',
    operation,
    taskId: id(params.taskId),
    contactId: id(params.contactId),
  })
}

describe('Wealthbox reads without an ID', () => {
  it('still requires a task ID on the canvas', () => {
    expect(() =>
      mapParams({ operation: 'read_task', oauthCredential: 'cred', taskId: '' })
    ).toThrow('Task ID is required')
  })

  it('still requires a contact ID on the canvas', () => {
    expect(() =>
      mapParams({ operation: 'read_contact', oauthCredential: 'cred', contactId: '' })
    ).toThrow('Contact ID is required')
  })

  it('lists tasks on an agent call with no task ID', () => {
    const params = mapParams({ oauthCredential: 'cred' }, { operation: 'read_task' })

    expect(readUrl(wealthboxReadTaskTool, 'read_task', params)).toBe(
      'https://api.crmworkspace.com/v1/tasks'
    )
  })

  it('lists contacts on an agent call with no contact ID', () => {
    const params = mapParams({ oauthCredential: 'cred' }, { operation: 'read_contact' })

    expect(readUrl(wealthboxReadContactTool, 'read_contact', params)).toBe(
      'https://api.crmworkspace.com/v1/contacts'
    )
  })
})

describe('Wealthbox Write Task with a stale Read Task ID', () => {
  it('drops a stored task ID on an agent call too', () => {
    const params = mapParams(
      { oauthCredential: 'cred', title: 'Call client', dueDate: 'tomorrow', taskId: '999' },
      { operation: 'write_task' }
    )

    expect(params.taskId).toBeUndefined()
  })

  it('creates the task instead of posting to the stale task path', () => {
    const params = mapParams({
      operation: 'write_task',
      oauthCredential: 'cred',
      title: 'Call client',
      dueDate: '2026-01-05 11:00 AM -0500',
      contactId: '42',
      taskId: '999',
    })
    const url = wealthboxWriteTaskTool.request.url
    if (typeof url !== 'function') throw new Error('Write task tool has no URL builder')

    expect(
      url({
        accessToken: 'token',
        operation: 'write_task',
        taskId: typeof params.taskId === 'string' ? params.taskId : undefined,
      })
    ).toBe('https://api.crmworkspace.com/v1/tasks')
  })
})
