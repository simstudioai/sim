/**
 * Tool calls pass the operation only in context and supply model arguments under the tool's param
 * names, so the add-member mapping must run there without overwriting what the model sent. An Agent
 * tool row never stores Member Email or Member Name (no tool param matches them); the block-field
 * case covers surfaces that pass raw block params with a context operation.
 */
import { describe, expect, it } from 'vitest'
import { MailgunV2Block } from '@/blocks/blocks/mailgun'
import type { BlockToolParamsContext } from '@/blocks/types'
import { mailgunAddListMemberTool } from '@/tools/mailgun/add_list_member'
import { mailgunGetMailingListTool } from '@/tools/mailgun/get_mailing_list'
import type { ToolConfig } from '@/tools/types'
import { validateRequiredParametersAfterMerge } from '@/tools/utils'

function mapParams(
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> {
  const mapped = MailgunV2Block.tools.config?.params?.(inputs, context) ?? {}
  return { ...inputs, ...mapped }
}

function requestUrl(tool: ToolConfig, params: Record<string, unknown>): string {
  const url = tool.request.url
  return typeof url === 'function' ? url(params) : url
}

function formFields(
  params: Record<string, unknown>,
  tool: ToolConfig = mailgunAddListMemberTool
): Record<string, FormDataEntryValue> {
  const build = tool.request.body
  if (typeof build !== 'function') throw new Error('add_list_member has no request body')
  const { body } = build(params) as { body: FormData }
  return Object.fromEntries(body.entries())
}

describe('Mailgun block add_list_member mapping', () => {
  it('adds the member the model named to the list the model named', () => {
    const params = mapParams(
      { apiKey: 'key', listAddress: 'news@mg.example.com', address: 'alice@example.com' },
      { operation: 'add_list_member' }
    )
    expect(requestUrl(mailgunAddListMemberTool, params)).toBe(
      'https://api.mailgun.net/v3/lists/news@mg.example.com/members'
    )
    expect(formFields(params).address).toBe('alice@example.com')
  })

  it('sends block-field Member Email and Name instead of the list address on a tool call', () => {
    const params = mapParams(
      {
        apiKey: 'key',
        listAddress: 'news@mg.example.com',
        address: 'news@mg.example.com',
        memberAddress: 'bob@example.com',
        memberName: 'Bob',
      },
      { operation: 'add_list_member' }
    )
    expect(formFields(params)).toMatchObject({ address: 'bob@example.com', name: 'Bob' })
  })

  it('adds the member even when the model names the list address as the member', () => {
    const params = mapParams(
      { apiKey: 'key', listAddress: 'news@mg.example.com', address: 'news@mg.example.com' },
      { operation: 'add_list_member', pinnedParams: new Set(['apiKey']) }
    )
    expect(formFields(params).address).toBe('news@mg.example.com')
  })

  it('never adds the row-saved List Address to its own list as a member', () => {
    const params = mapParams(
      { apiKey: 'key', address: 'news@mg.example.com' },
      { operation: 'add_list_member', pinnedParams: new Set(['apiKey', 'address']) }
    )
    expect(requestUrl(mailgunAddListMemberTool, params)).toBe(
      'https://api.mailgun.net/v3/lists/news@mg.example.com/members'
    )
    expect(() =>
      validateRequiredParametersAfterMerge(
        'mailgun_add_list_member',
        mailgunAddListMemberTool,
        params
      )
    ).toThrow('Address is required')
  })

  it.each([
    ['a stored string', 'false', 'no'],
    ['a model boolean', false, 'no'],
    ['a model boolean', true, 'yes'],
  ])('honors subscribed given as %s (%j) on a tool call', (_label, subscribed, expected) => {
    const params = mapParams(
      { apiKey: 'key', listAddress: 'l@mg.example.com', address: 'a@x.com', subscribed },
      { operation: 'add_list_member' }
    )
    expect(formFields(params).subscribed).toBe(expected)
  })

  it('maps the canvas List Address and Member Email as before', () => {
    const params = mapParams({
      apiKey: 'key',
      operation: 'add_list_member',
      address: 'news@mg.example.com',
      memberAddress: 'carol@example.com',
      subscribed: 'false',
    })
    expect(requestUrl(mailgunAddListMemberTool, params)).toBe(
      'https://api.mailgun.net/v3/lists/news@mg.example.com/members'
    )
    expect(formFields(params)).toMatchObject({ address: 'carol@example.com', subscribed: 'no' })
  })
})

describe('Mailgun list address path segment', () => {
  it('rejects a list address that would escape its path segment', () => {
    expect(() =>
      requestUrl(mailgunGetMailingListTool, {
        apiKey: 'key',
        address: 'x@mg.example.com/../../domains',
      })
    ).toThrow(/path separator/)
  })

  it('keeps a query delimiter inside the segment', () => {
    expect(
      requestUrl(mailgunGetMailingListTool, { apiKey: 'key', address: 'news+a@mg.example.com?x=1' })
    ).toBe('https://api.mailgun.net/v3/lists/news+a@mg.example.com%3Fx=1')
  })
})
