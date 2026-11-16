/**
 * Workflow runs hand a tool `{ ...rawInputs, ...mappedParams }`, and the serializer keeps advanced
 * values saved under another operation, so the mapper may only rename a field for the operation it
 * belongs to. Agent tool calls pass the operation in context, never in params.
 */
import { describe, expect, it } from 'vitest'
import { SendGridV2Block } from '@/blocks/blocks/sendgrid'
import { sendGridDeleteListTool } from '@/tools/sendgrid/delete_list'
import { sendGridDeleteTemplateTool } from '@/tools/sendgrid/delete_template'
import { sendGridListAllListsTool } from '@/tools/sendgrid/list_all_lists'
import { sendGridListTemplatesTool } from '@/tools/sendgrid/list_templates'
import type { ToolConfig } from '@/tools/types'

const CREDENTIAL = { oauthCredential: 'cred-1', apiKey: 'SG.test' }

function requestUrl(tool: ToolConfig, params: Record<string, unknown>): URL {
  const { url } = tool.request
  return new URL(typeof url === 'function' ? url(params) : url)
}

function workflowParams(inputs: Record<string, unknown>): Record<string, unknown> {
  const mapped = SendGridV2Block.tools.config?.params?.(inputs) ?? {}
  return { ...inputs, ...mapped }
}

function agentParams(operation: string, args: Record<string, unknown>): Record<string, unknown> {
  const inputs = { ...CREDENTIAL, ...args }
  const mapped = SendGridV2Block.tools.config?.params?.(inputs, { operation }) ?? {}
  return { ...inputs, ...mapped }
}

describe('SendGrid block parameter mapping', () => {
  it('deletes the template the user entered, not a Send Mail template id left behind', () => {
    const params = workflowParams({
      ...CREDENTIAL,
      operation: 'delete_template',
      mailTemplateId: 'd-AAA',
      templateId: 'd-BBB',
    })
    expect(requestUrl(sendGridDeleteTemplateTool, params).pathname).toBe('/v3/templates/d-BBB')
  })

  it('ignores a list page size left behind when listing templates', () => {
    const params = workflowParams({
      ...CREDENTIAL,
      operation: 'list_templates',
      listPageSize: '500',
    })
    expect(requestUrl(sendGridListTemplatesTool, params).searchParams.get('page_size')).toBe('20')
  })

  it('maps a stored template page token on an agent tool call', () => {
    const params = agentParams('list_templates', { templatePageToken: 'tok-2' })
    expect(requestUrl(sendGridListTemplatesTool, params).searchParams.get('page_token')).toBe(
      'tok-2'
    )
  })

  it('keeps the page size and token the model supplied', () => {
    const params = agentParams('list_all_lists', { pageSize: 250, pageToken: 'tok-9' })
    const url = requestUrl(sendGridListAllListsTool, params)
    expect(url.searchParams.get('page_size')).toBe('250')
    expect(url.searchParams.get('page_token')).toBe('tok-9')
  })
})

describe('SendGrid path ids', () => {
  it('rejects a list id that would escape the lists path', () => {
    expect(() =>
      requestUrl(sendGridDeleteListTool, { ...CREDENTIAL, listId: '../../templates/d-XYZ' })
    ).toThrow(/listId/)
  })
})
