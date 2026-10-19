import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { ZohoDeskBlock } from '@/blocks/blocks/zoho-desk'
import * as blockRegistry from '@/blocks/registry'
import { prepareToolExecution, transformBlockTool } from '@/providers/utils'
import { prepareBlockState } from '@/stores/workflows/prepare-block-state'
import * as toolMetadata from '@/tools/metadata'
import { getSubBlocksForToolInput } from '@/tools/params'
import { zohoDeskCreateTicketTool } from '@/tools/zoho_desk/create_ticket'
import { zohoDeskListTicketsTool } from '@/tools/zoho_desk/list_tickets'
import { zohoDeskSearchAccountsTool } from '@/tools/zoho_desk/search_accounts'
import { zohoDeskSearchContactsTool } from '@/tools/zoho_desk/search_contacts'
import { zohoDeskSearchTicketsTool } from '@/tools/zoho_desk/search_tickets'
import { zohoDeskSendReplyTool } from '@/tools/zoho_desk/send_reply'
import { zohoDeskUpdateAccountTool } from '@/tools/zoho_desk/update_account'
import { zohoDeskUpdateContactTool } from '@/tools/zoho_desk/update_contact'
import { zohoDeskUpdateTicketTool } from '@/tools/zoho_desk/update_ticket'

let metadataSpy: MockInstance<typeof toolMetadata.getToolMetadata>

beforeEach(() => {
  metadataSpy = vi
    .spyOn(toolMetadata, 'getToolMetadata')
    .mockImplementation((id) =>
      [
        zohoDeskCreateTicketTool,
        zohoDeskListTicketsTool,
        zohoDeskSendReplyTool,
        zohoDeskSearchTicketsTool,
        zohoDeskSearchContactsTool,
        zohoDeskSearchAccountsTool,
      ].find((tool) => tool.id === id)
    )
})

afterEach(() => metadataSpy.mockRestore())

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

describe('Zoho Desk operation transitions', () => {
  it.each([
    {
      operation: 'search_tickets',
      target: 'update_ticket',
      title: 'Subject',
      filter: 'billing*',
      replacement: { priority: 'High' },
      buildBody: (params: Record<string, unknown>) => {
        const body = zohoDeskUpdateTicketTool.request.body
        if (typeof body !== 'function') throw new Error('Update body missing')
        return body({
          accessToken: 'fixture',
          orgId: 'org-fixture',
          ticketId: 'ticket-fixture',
          ...params,
        })
      },
    },
    {
      operation: 'search_contacts',
      target: 'update_contact',
      title: 'Email',
      filter: 'person*',
      replacement: { firstName: 'Updated' },
      buildBody: (params: Record<string, unknown>) => {
        const body = zohoDeskUpdateContactTool.request.body
        if (typeof body !== 'function') throw new Error('Update body missing')
        return body({
          accessToken: 'fixture',
          orgId: 'org-fixture',
          contactId: 'contact-fixture',
          ...params,
        })
      },
    },
    {
      operation: 'search_accounts',
      target: 'update_account',
      title: 'Account Name',
      filter: 'Example*',
      replacement: { website: 'https://example.com' },
      buildBody: (params: Record<string, unknown>) => {
        const body = zohoDeskUpdateAccountTool.request.body
        if (typeof body !== 'function') throw new Error('Update body missing')
        return body({
          accessToken: 'fixture',
          orgId: 'org-fixture',
          accountId: 'account-fixture',
          ...params,
        })
      },
    },
  ])(
    'does not send retained $operation filters in a later update',
    ({ operation, target, title, filter, replacement, buildBody }) => {
      const editor = getSubBlocksForToolInput(
        `zoho_desk_${operation}`,
        'zoho_desk',
        { operation },
        undefined,
        ZohoDeskBlock
      )
      const input = editor?.subBlocks.find((field) => field.title === title)
      if (!input) throw new Error(`Search input missing: ${title}`)
      const mapper = ZohoDeskBlock.tools.config?.params
      if (!mapper) throw new Error('Request mapping missing')
      const stored = { operation: target, [input.id]: filter, ...replacement }
      const mapped = mapper(stored)
      expect(buildBody(mapped)).toEqual(replacement)
    }
  )

  it('does not send a webhook direction default in a newly created reply action', () => {
    vi.spyOn(blockRegistry, 'getBlock').mockReturnValue(ZohoDeskBlock)
    const state = prepareBlockState({
      id: 'block-fixture',
      type: 'zoho_desk',
      name: 'Zoho Desk',
      position: { x: 0, y: 0 },
    })
    const mapper = ZohoDeskBlock.tools.config?.params
    const body = zohoDeskSendReplyTool.request.body
    if (!mapper || typeof body !== 'function') throw new Error('Reply mapping missing')
    const values = Object.fromEntries(
      Object.entries(state.subBlocks).map(([key, field]) => [key, field.value])
    )
    const mapped = mapper({
      ...values,
      operation: 'send_reply',
      content: 'Reply',
      fromEmailAddress: 'support@example.com',
    })
    expect(
      body({
        accessToken: 'fixture',
        orgId: 'org-fixture',
        ticketId: 'ticket-fixture',
        content: '',
        fromEmailAddress: '',
        ...mapped,
      })
    ).not.toHaveProperty('direction')
  })
})
