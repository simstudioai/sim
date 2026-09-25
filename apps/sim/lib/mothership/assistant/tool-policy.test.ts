import { describe, expect, it } from 'vitest'
import {
  assertAssistantIntegrationCall,
  isAssistantIntegrationTool,
} from '@/lib/mothership/assistant/tool-policy'
import type { ToolMetadata } from '@/tools/metadata'

const tool: ToolMetadata = {
  id: 'google_drive_get_file',
  oauth: { required: true, provider: 'google-drive', authoritativeParams: ['instanceUrl'] },
  params: {
    credential: { type: 'string', visibility: 'user-only' },
    accessToken: { type: 'string', visibility: 'hidden' },
    body: { type: 'string', visibility: 'user-or-llm' },
    impersonateUserEmail: { type: 'string', visibility: 'user-or-llm' },
    instanceUrl: { type: 'string', visibility: 'user-or-llm' },
  },
}

describe('Assistant integration policy', () => {
  const tokenTool: ToolMetadata = {
    id: 'gitlab_list_projects',
    personalToken: { provider: 'gitlab', tokenParam: 'accessToken', hostParam: 'host' },
    params: {
      accessToken: { type: 'string', required: true, visibility: 'user-only' },
      host: { type: 'string', visibility: 'user-only' },
      projectId: { type: 'string', required: true, visibility: 'user-or-llm' },
    },
  }

  it('accepts a personal token binding without exposing its secret or host', () => {
    expect(isAssistantIntegrationTool(tokenTool)).toBe(true)
    expect(() =>
      assertAssistantIntegrationCall(tokenTool, { credentialId: 'mine', projectId: '1' })
    ).not.toThrow()
    for (const name of ['accessToken', 'host']) {
      expect(() =>
        assertAssistantIntegrationCall(tokenTool, { credentialId: 'mine', [name]: 'override' })
      ).toThrow()
    }
    expect(isAssistantIntegrationTool({ ...tokenTool, params: {} })).toBe(false)
  })

  it('allows selected reads with one explicit connected account', () => {
    expect(() =>
      assertAssistantIntegrationCall(tool, { credential: 'mine', body: 'updated content' })
    ).not.toThrow()
  })

  it.each(['gmail_send', 'google_drive_create_file', 'new_provider_operation'])(
    'rejects unapproved operation %s even with a personal account',
    (id) => {
      expect(isAssistantIntegrationTool({ ...tool, id })).toBe(false)
      expect(() =>
        assertAssistantIntegrationCall({ ...tool, id }, { credential: 'mine' })
      ).toThrow()
    }
  )

  it.each(['accessToken', 'apiKey', 'headers', '_context', 'impersonateUserEmail', 'instanceUrl'])(
    'rejects model-supplied %s before execution',
    (name) =>
      expect(() =>
        assertAssistantIntegrationCall(tool, { credential: 'mine', [name]: 'override' })
      ).toThrow()
  )

  it.each([
    {},
    { credential: '' },
    { credential: 5 },
    { credential: 'mine', credentialId: 'theirs' },
  ])('requires an unambiguous account selector', (params) =>
    expect(() => assertAssistantIntegrationCall(tool, params)).toThrow('Select one')
  )

  it('excludes API keys, service accounts, and bot-only operations', () => {
    expect(isAssistantIntegrationTool({ ...tool, oauth: undefined })).toBe(false)
    expect(
      isAssistantIntegrationTool({
        ...tool,
        oauth: { ...tool.oauth!, credentialKind: 'service-account' },
      })
    ).toBe(false)
    expect(
      isAssistantIntegrationTool({
        ...tool,
        oauth: { ...tool.oauth!, personalTokenSupported: false },
      })
    ).toBe(false)
    expect(isAssistantIntegrationTool(undefined)).toBe(false)
  })
})
