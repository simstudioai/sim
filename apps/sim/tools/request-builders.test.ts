/**
 * @vitest-environment node
 */
import { toRecord } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { discordSendMessageTool } from '@/tools/discord/send_message'
import { appendTool, appendV2Tool } from '@/tools/google_sheets/append'
import { updateV2Tool } from '@/tools/google_sheets/update'
import { writeV2Tool } from '@/tools/google_sheets/write'
import { hubspotCreateContactTool } from '@/tools/hubspot/create_contact'
import { linearCreateIssueTool } from '@/tools/linear/create_issue'
import { describeToolRequest } from '@/tools/side-effects'
import { insertTool as supabaseInsertTool } from '@/tools/supabase/insert'
import type { ExecutableToolConfig } from '@/tools/types'

/** What `tool` sends for `params`: an HTTP request's body, or an in-process operation's input. */
function sent(tool: ExecutableToolConfig, params: Record<string, unknown>): unknown {
  const request = describeToolRequest(tool, params)
  return tool.operation ? request : toRecord(request).body
}

const SHEET = { accessToken: 'token', spreadsheetId: 'sheet-1', sheetName: 'Leads' }

/**
 * The request builders whose normalisation dry-run placeholders now share, held to the bodies they
 * sent before that normalisation moved into shared helpers.
 */
describe('a write request built from edge-case params', () => {
  it.each([
    {
      case: 'append: objects and arrays mixed read keys from both',
      tool: appendV2Tool,
      params: { ...SHEET, values: [{ a: 1 }, ['x', 'y']] },
      body: {
        majorDimension: 'ROWS',
        values: [
          ['a', '0', '1'],
          [1, '', ''],
          ['', 'x', 'y'],
        ],
      },
    },
    {
      case: 'append: a null first entry takes the object path',
      tool: appendV2Tool,
      params: { ...SHEET, values: [null, { a: 1, b: { c: 2 } }] },
      body: {
        majorDimension: 'ROWS',
        values: [
          ['a', 'b'],
          ['', ''],
          [1, '{"c":2}'],
        ],
      },
    },
    {
      case: 'append: a JSON string is parsed',
      tool: appendV2Tool,
      params: { ...SHEET, values: '[["a",1]]' },
      body: { majorDimension: 'ROWS', values: [['a', 1]] },
    },
    {
      case: 'append: a string that is not JSON is one cell',
      tool: appendV2Tool,
      params: { ...SHEET, values: 'not json' },
      body: { majorDimension: 'ROWS', values: [['not json']] },
    },
    {
      case: 'append: scalars become one-cell rows as strings',
      tool: appendTool,
      params: { accessToken: 'token', spreadsheetId: 'sheet-1', range: 'A1', values: ['a', 2] },
      body: { majorDimension: 'ROWS', values: [['a'], ['2']], range: 'A1' },
    },
    {
      case: 'write: objects and arrays mixed read keys from both',
      tool: writeV2Tool,
      params: { ...SHEET, values: [{ a: 1 }, ['x']] },
      body: {
        majorDimension: 'ROWS',
        values: [
          ['a', '0'],
          [1, ''],
          ['', 'x'],
        ],
      },
    },
    {
      case: 'write: a scalar is sent as given',
      tool: writeV2Tool,
      params: { ...SHEET, values: 'x' },
      body: { majorDimension: 'ROWS', values: 'x' },
    },
    {
      case: 'update: scalars and objects are wrapped, never turned into headers',
      tool: updateV2Tool,
      params: { ...SHEET, values: ['a', { b: 2 }] },
      body: { majorDimension: 'ROWS', values: [['a'], [{ b: 2 }]] },
    },
    {
      case: 'HubSpot: properties given as a JSON string are parsed',
      tool: hubspotCreateContactTool,
      params: { accessToken: 'token', properties: '{"email":"a@b.co"}' },
      body: { properties: { email: 'a@b.co' } },
    },
    {
      case: 'Supabase: one row is sent as a one-row array',
      tool: supabaseInsertTool,
      params: { apiKey: 'key', projectId: 'abcdefghijklmnop', table: 'leads', data: { a: 1 } },
      body: [{ a: 1 }],
    },
    {
      case: 'Supabase: an array of rows is sent as given',
      tool: supabaseInsertTool,
      params: { apiKey: 'key', projectId: 'abcdefghijklmnop', table: 'leads', data: [{ a: 1 }] },
      body: [{ a: 1 }],
    },
  ])('$case', ({ tool, params, body }) => {
    expect(sent(tool, params)).toEqual(body)
  })

  it('Linear sends only the optional fields that are set, numbers coerced', () => {
    const body = sent(linearCreateIssueTool, {
      accessToken: 'token',
      teamId: 'team-1',
      title: 'Fix it',
      projectId: '',
      priority: '2',
      labelIds: ['l1'],
    })

    expect(body).toMatchObject({
      variables: { input: { teamId: 'team-1', title: 'Fix it', priority: 2, labelIds: ['l1'] } },
    })
  })

  it('a malformed HubSpot properties string fails the request', () => {
    expect(() =>
      sent(hubspotCreateContactTool, { accessToken: 'token', properties: '{not json' })
    ).toThrow('Invalid JSON format for properties')
  })

  it.each([
    { content: '', files: [], sent: 'Message sent from Sim' },
    { content: '', files: [{ name: 'a.txt' }], sent: undefined },
    { content: 'hi', files: [], sent: 'hi' },
  ])(
    'Discord sends $sent for content "$content" and $files.length files',
    ({ content, files, sent: expected }) => {
      const input = sent(discordSendMessageTool, {
        botToken: 'bot',
        channelId: '42',
        content,
        files,
      })

      expect(input).toMatchObject({ content: expected })
    }
  )
})
