import { describe, expect, it } from 'vitest'
import { ZohoDeskBlock } from '@/blocks/blocks/zoho-desk'
import { prepareToolExecution, transformBlockTool } from '@/providers/utils'
import { getSubBlocksForToolInput } from '@/tools/params'
import { zohoDeskCreateTicketTool } from '@/tools/zoho_desk/create_ticket'
import { zohoDeskListTicketsTool } from '@/tools/zoho_desk/list_tickets'
import { zohoDeskSendReplyTool } from '@/tools/zoho_desk/send_reply'

const editorParams = (toolId: string, operation: string, values: Record<string, unknown>) => {
  const fields = getSubBlocksForToolInput(
    toolId,
    'zoho_desk',
    { operation },
    undefined,
    ZohoDeskBlock
  )
  if (!fields) throw new Error('Zoho Desk editor was not created')
  const stored: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(values)) {
    const field = fields.subBlocks.find((candidate) => candidate.id === name)
    if (!field) throw new Error(`No editable input for ${name}`)
    stored[field.id] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return stored
}

describe('Zoho Desk configured agent requests', () => {
  it('sends configured ticket fields ahead of model suggestions', async () => {
    const stored = editorParams(zohoDeskCreateTicketTool.id, 'create_ticket', {
      subject: 'Configured subject',
      departmentId: 'department-fixture',
      contact: { email: 'person@example.com' },
    })
    const provider = await transformBlockTool(
      { type: 'zoho_desk', params: stored },
      {
        selectedOperation: 'create_ticket',
        getAllBlocks: () => [ZohoDeskBlock],
        getTool: () => zohoDeskCreateTicketTool,
      }
    )
    if (!provider) throw new Error('Zoho Desk agent tool was not created')
    const { executionParams } = prepareToolExecution(
      provider,
      { subject: 'Model suggestion' },
      {},
      undefined
    )
    const body = zohoDeskCreateTicketTool.request.body
    if (typeof body !== 'function') throw new Error('Ticket body builder missing')
    expect(
      body({
        accessToken: 'fixture',
        orgId: 'org-fixture',
        subject: '',
        departmentId: '',
        ...executionParams,
      })
    ).toMatchObject({
      subject: 'Configured subject',
      departmentId: 'department-fixture',
      contact: { email: 'person@example.com' },
    })
  })

  it('preserves configured false flags and attachment arrays through dropdown decoding', async () => {
    const stored = editorParams(zohoDeskSendReplyTool.id, 'send_reply', {
      ticketId: 'ticket-fixture',
      content: 'Reply',
      fromEmailAddress: 'support@example.com',
      isPrivate: false,
      isForward: false,
      attachmentIds: ['attachment-fixture'],
    })
    const provider = await transformBlockTool(
      { type: 'zoho_desk', params: stored },
      {
        selectedOperation: 'send_reply',
        getAllBlocks: () => [ZohoDeskBlock],
        getTool: () => zohoDeskSendReplyTool,
      }
    )
    if (!provider) throw new Error('Zoho Desk agent tool was not created')
    const { executionParams } = prepareToolExecution(
      provider,
      { isPrivate: true, isForward: true, attachmentIds: ['model-attachment'] },
      {},
      undefined
    )
    const body = zohoDeskSendReplyTool.request.body
    if (typeof body !== 'function') throw new Error('Reply body builder missing')
    expect(
      body({
        accessToken: 'fixture',
        orgId: 'org-fixture',
        ticketId: '',
        content: '',
        fromEmailAddress: '',
        ...executionParams,
      })
    ).toMatchObject({ isForward: false, attachmentIds: ['attachment-fixture'] })
    const url = zohoDeskSendReplyTool.request.url
    if (typeof url !== 'function') throw new Error('Reply URL builder missing')
    const query = new URL(
      url({
        accessToken: 'fixture',
        orgId: 'org-fixture',
        ticketId: '',
        content: '',
        fromEmailAddress: '',
        ...executionParams,
      })
    ).searchParams
    expect(query.get('isPrivate')).toBe('false')
  })

  it('lets the model fill cleared fields and retains configured legacy filters', async () => {
    const stored = editorParams(zohoDeskListTicketsTool.id, 'list_tickets', {
      statusFilter: 'Open',
    })
    const provider = await transformBlockTool(
      { type: 'zoho_desk', params: { ...stored, subject: '', priorityFilter: '' } },
      {
        selectedOperation: 'list_tickets',
        getAllBlocks: () => [ZohoDeskBlock],
        getTool: () => zohoDeskListTicketsTool,
      }
    )
    if (!provider) throw new Error('Zoho Desk agent tool was not created')
    const { executionParams } = prepareToolExecution(
      provider,
      { status: 'Closed', priority: 'High' },
      {},
      undefined
    )
    const url = zohoDeskListTicketsTool.request.url
    if (typeof url !== 'function') throw new Error('Ticket list URL builder missing')
    const query = new URL(url({ accessToken: 'fixture', orgId: 'org-fixture', ...executionParams }))
      .searchParams
    expect(query.get('status')).toBe('Open')
    expect(query.get('priority')).toBe('High')
  })
})
