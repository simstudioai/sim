/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing/factories/execution.factory'
import { toRecord } from '@sim/utils/object'
import { describe, expect, it, vi } from 'vitest'
import { WriteStubPolicy } from '@/lib/workflows/dry-run'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { confluenceCreatePageTool } from '@/tools/confluence/create_page'
import { appendV2Tool } from '@/tools/google_sheets/append'
import { hubspotUpdateContactTool } from '@/tools/hubspot/update_contact'
import { hubspotUpdateDealTool } from '@/tools/hubspot/update_deal'
import { knowledgeUpsertDocumentTool } from '@/tools/knowledge/upsert_document'
import { resendSendTool } from '@/tools/resend/send'
import { answerUnsentCall, describeToolRequest, unsentWriteFor } from '@/tools/side-effects'
import { slackMessageTool } from '@/tools/slack/message'
import { telegramMessageTool } from '@/tools/telegram/message'
import type { ExecutableToolConfig } from '@/tools/types'
import { zendeskCreateTicketTool } from '@/tools/zendesk/create_ticket'

vi.unmock('@/tools/metadata-outputs')

const TOOLS = new Map<string, ExecutableToolConfig>(
  [
    appendV2Tool,
    confluenceCreatePageTool,
    hubspotUpdateContactTool,
    hubspotUpdateDealTool,
    knowledgeUpsertDocumentTool,
    resendSendTool,
    slackMessageTool,
    telegramMessageTool,
    zendeskCreateTicketTool,
  ].map((tool) => [tool.id, tool])
)

const SECRET = 'live-credential-8c1f'

/** The placeholder a dry run answers one unsent `toolId` call with, through the real seam. */
async function placeholderFor(toolId: string, params: Record<string, unknown>) {
  const tool = TOOLS.get(toolId)
  if (!tool) throw new Error(`No tool ${toolId} in this suite`)
  const policy = new WriteStubPolicy({ workflowId: 'wf-1' })
  const callParams = { ...params, _context: { blockId: 'write' } }
  const write = unsentWriteFor({
    toolId,
    params: callParams,
    executionContext: {
      ...createExecutionContext({ workflowId: 'wf-1' }),
      sideEffects: policy,
    } as ExecutionContext,
  })
  if (!write) throw new Error('The policy sent the write')
  const response = await answerUnsentCall(write, {
    params: callParams,
    registry: new ResolvedSecretTraceRegistry(),
    describe: (masked) => describeToolRequest(tool, masked),
    echo: tool.dryRunOutput,
  })
  return response.output
}

describe('a dry run’s placeholder for an unsent write', () => {
  it.each([
    {
      toolId: 'google_sheets_append_v2',
      params: {
        accessToken: SECRET,
        spreadsheetId: 'sheet-1',
        sheetName: 'Leads',
        values: [{ name: 'Ada', note: `key ${SECRET}` }, { name: 'Bob' }],
        includeValuesInResponse: true,
      },
      echoed: {
        updatedRows: 3,
        updatedColumns: 2,
        updatedCells: 6,
        updatedData: {
          majorDimension: 'ROWS',
          values: [
            ['name', 'note'],
            ['Ada', 'key [REDACTED]'],
            ['Bob', ''],
          ],
        },
      },
    },
    {
      toolId: 'hubspot_update_contact',
      params: {
        accessToken: SECRET,
        contactId: 'ada@example.com',
        idProperty: 'email',
        properties: JSON.stringify({ firstname: 'Ada', zip: 94107, jobtitle: `holds ${SECRET}` }),
      },
      echoed: {
        contact: {
          id: 'dry_run_contact_1',
          properties: { firstname: 'Ada', zip: '94107', jobtitle: 'holds [REDACTED]' },
        },
      },
    },
    {
      toolId: 'slack_message',
      params: {
        accessToken: SECRET,
        destinationType: 'dm',
        dmUserId: 'U123',
        text: `deploy with ${SECRET}`,
        threadTs: ' 1700000000.000100 ',
      },
      echoed: {
        message: { text: 'deploy with [REDACTED]', thread_ts: '1700000000.000100' },
      },
    },
    {
      toolId: 'resend_send',
      params: {
        resendApiKey: SECRET,
        fromAddress: 'a@b.co',
        to: 'c@d.co',
        subject: 'Hi',
        body: `token ${SECRET}`,
      },
      echoed: { to: 'c@d.co', subject: 'Hi', body: 'token [REDACTED]' },
    },
  ])(
    '$toolId echoes what its request determines with its secrets masked',
    async ({ toolId, params, echoed }) => {
      const returned = await placeholderFor(toolId, params)

      expect(returned).toMatchObject(echoed)
      expect(JSON.stringify(returned)).not.toContain(SECRET)
    }
  )

  it.each([
    {
      case: 'a HubSpot record named by another id property keeps a placeholder id',
      toolId: 'hubspot_update_deal',
      params: { accessToken: SECRET, dealId: 'deal-key', idProperty: 'deal_key', properties: {} },
      read: (returned: Record<string, unknown>) => returned.dealId,
      not: 'deal-key',
    },
    {
      case: 'an upsert names the document it replaces as previous, never as its own',
      toolId: 'knowledge_upsert_document',
      params: { knowledgeBaseId: 'kb1', name: 'Runbook', content: 'steps', documentId: 'doc-old' },
      read: (returned: Record<string, unknown>) => toRecord(returned.data).documentId,
      not: 'doc-old',
    },
    {
      case: 'a Slack DM reports the channel Slack opens, not the user it names',
      toolId: 'slack_message',
      params: { accessToken: SECRET, destinationType: 'dm', dmUserId: 'U123', text: 'hi' },
      read: (returned: Record<string, unknown>) => returned.channel,
      not: 'U123',
    },
    {
      case: 'Slack text that Slack returns escaped is not echoed as sent',
      toolId: 'slack_message',
      params: { accessToken: SECRET, channel: 'C1', text: 'Q&A <today>' },
      read: (returned: Record<string, unknown>) => toRecord(returned.message).text,
      not: 'Q&A <today>',
    },
    {
      case: 'a Confluence page created in a space named by key reports the id Confluence resolves',
      toolId: 'confluence_create_page',
      params: {
        accessToken: SECRET,
        domain: 'acme.atlassian.net',
        spaceId: 'ENG',
        title: 'Notes',
        content: '<p>x</p>',
      },
      read: (returned: Record<string, unknown>) => returned.spaceId,
      not: 'ENG',
    },
  ])('$case', async ({ toolId, params, read, not }) => {
    const returned = await placeholderFor(toolId, params)

    expect(read(returned)).toEqual(expect.stringMatching(/^dry_run_/))
    expect(read(returned)).not.toBe(not)
  })

  it.each([
    {
      toolId: 'knowledge_upsert_document',
      params: { knowledgeBaseId: 'kb1', name: 'Runbook', content: 'steps' },
      pairs: [
        [
          (r: Record<string, unknown>) => toRecord(r.data).documentId,
          (r: Record<string, unknown>) => r.documentId,
        ],
      ],
    },
    {
      toolId: 'zendesk_create_ticket',
      params: { accessToken: SECRET, subdomain: 'acme', subject: 'Help', description: 'x' },
      pairs: [
        [
          (r: Record<string, unknown>) => toRecord(r.ticket).id,
          (r: Record<string, unknown>) => r.ticket_id,
        ],
      ],
    },
    {
      toolId: 'slack_message',
      params: { accessToken: SECRET, channel: 'C1', text: 'hi' },
      pairs: [
        [
          (r: Record<string, unknown>) => toRecord(r.message).ts,
          (r: Record<string, unknown>) => r.ts,
        ],
        [
          (r: Record<string, unknown>) => toRecord(r.message).channel,
          (r: Record<string, unknown>) => r.channel,
        ],
      ],
    },
  ])(
    '$toolId reports one placeholder id wherever its output repeats it',
    async ({ toolId, params, pairs }) => {
      const returned = await placeholderFor(toolId, params)

      for (const [nested, topLevel] of pairs) {
        expect(nested(returned)).toBeDefined()
        expect(nested(returned)).toBe(topLevel(returned))
      }
    }
  )

  it('echoes the chat a Telegram message names by a numeric id given as a number', async () => {
    const returned = await placeholderFor('telegram_message', {
      botToken: SECRET,
      chatId: -1001234,
      text: 'hi',
    })

    expect(returned).toMatchObject({ data: { chat: { id: -1001234 } } })
  })

  it('samples a file list a placeholder cannot hold as empty', async () => {
    const returned = await placeholderFor('slack_message', {
      accessToken: SECRET,
      channel: 'C1',
      text: 'hi',
    })

    expect(returned.files).toEqual([])
  })
})
