/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/credential-extractor'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

vi.unmock('@/blocks/registry')

function workflowState(): WorkflowState {
  return {
    blocks: {
      slack: {
        id: 'slack',
        type: 'slack',
        name: 'Slack',
        enabled: true,
        subBlocks: {
          credential: { id: 'credential', type: 'oauth-input', value: 'cred-basic' },
          manualCredential: {
            id: 'manualCredential',
            type: 'short-input',
            value: 'cred-advanced',
          },
          botToken: { id: 'botToken', type: 'short-input', value: 'xoxb-private' },
          channel: { id: 'channel', type: 'channel-selector', value: 'C_PRIVATE' },
          manualChannel: {
            id: 'manualChannel',
            type: 'short-input',
            value: 'C_PRIVATE_ADVANCED',
          },
          message: { id: 'message', type: 'long-input', value: 'hello' },
        },
      },
      agent: {
        id: 'agent',
        type: 'agent',
        name: 'Agent',
        enabled: true,
        subBlocks: {
          tools: {
            id: 'tools',
            type: 'tool-input',
            value: [
              {
                type: 'slack',
                params: {
                  credential: 'cred-tool',
                  oauthCredential: 'cred-tool-canonical',
                  channel: 'C_TOOL_PRIVATE',
                  message: 'keep me',
                  knowledgeBaseId: 'kb-workspace',
                  paginationToken: 'not-a-credential',
                },
              },
            ],
          },
        },
      },
      knowledge: {
        id: 'knowledge',
        type: 'knowledge',
        name: 'Knowledge',
        enabled: true,
        subBlocks: {
          knowledgeBaseId: {
            id: 'knowledgeBaseId',
            type: 'knowledge-base-selector',
            value: 'kb-workspace',
          },
        },
      },
      googleDocs: {
        id: 'googleDocs',
        type: 'google_docs',
        name: 'Google Docs',
        enabled: true,
        subBlocks: {
          credential: { id: 'credential', type: 'oauth-input', value: 'google-credential' },
          documentId: { id: 'documentId', type: 'file-selector', value: 'google-document' },
          manualDocumentId: {
            id: 'manualDocumentId',
            type: 'short-input',
            value: 'google-document-manual',
          },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  } as unknown as WorkflowState
}

describe('sanitizeWorkflowForSharing credential projection', () => {
  it('clears canonical credential groups and credential-scoped selectors', () => {
    const sanitized = sanitizeWorkflowForSharing(workflowState(), {
      preserveWorkspaceReferences: true,
    })
    const slack = sanitized.blocks?.slack

    expect(slack?.subBlocks.credential?.value).toBeNull()
    expect(slack?.subBlocks.manualCredential?.value).toBeNull()
    expect(slack?.subBlocks.botToken?.value).toBeNull()
    expect(slack?.subBlocks.channel?.value).toBeNull()
    expect(slack?.subBlocks.manualChannel?.value).toBeNull()
    expect(slack?.subBlocks.message?.value).toBe('hello')
    expect(sanitized.blocks?.knowledge.subBlocks.knowledgeBaseId?.value).toBe('kb-workspace')
    expect(sanitized.blocks?.googleDocs.subBlocks.documentId?.value).toBeNull()
    expect(sanitized.blocks?.googleDocs.subBlocks.manualDocumentId?.value).toBeNull()
  })

  it('removes credentials and account-scoped selectors from stored Agent tools', () => {
    const sanitized = sanitizeWorkflowForSharing(workflowState(), {
      preserveWorkspaceReferences: true,
    })
    const tools = sanitized.blocks?.agent.subBlocks.tools?.value as Array<{
      params: Record<string, unknown>
    }>

    expect(tools[0].params).toEqual({
      message: 'keep me',
      knowledgeBaseId: 'kb-workspace',
      paginationToken: 'not-a-credential',
    })
  })

  it('uses registered metadata instead of treating non-secret GitLab switches as passwords', () => {
    const state = {
      blocks: {
        gitlab: {
          id: 'gitlab',
          type: 'gitlab',
          name: 'GitLab',
          enabled: true,
          subBlocks: {
            userAdminPassword: {
              id: 'userAdminPassword',
              type: 'short-input',
              value: 'SENTINEL_GITLAB_PASSWORD',
            },
            resetPassword: { id: 'resetPassword', type: 'switch', value: true },
            forceRandomPassword: { id: 'forceRandomPassword', type: 'switch', value: true },
            unknownPassword: {
              id: 'unknownPassword',
              type: 'short-input',
              value: 'SENTINEL_UNKNOWN_PASSWORD',
            },
          },
          data: {
            userAdminPassword: 'SENTINEL_GITLAB_DATA_PASSWORD',
            resetPassword: true,
            forceRandomPassword: true,
          },
        },
        agent: {
          id: 'agent',
          type: 'agent',
          name: 'Agent',
          enabled: true,
          subBlocks: {
            tools: {
              id: 'tools',
              type: 'tool-input',
              value: [
                {
                  type: 'gitlab',
                  params: {
                    userAdminPassword: 'SENTINEL_STORED_GITLAB_PASSWORD',
                    resetPassword: true,
                    forceRandomPassword: true,
                  },
                },
              ],
            },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    } as unknown as WorkflowState

    const sanitized = sanitizeWorkflowForSharing(state)
    const gitlab = sanitized.blocks?.gitlab
    const tools = sanitized.blocks?.agent.subBlocks.tools?.value as Array<{
      params: Record<string, unknown>
    }>

    expect(gitlab?.subBlocks.userAdminPassword?.value).toBeNull()
    expect(gitlab?.subBlocks.unknownPassword?.value).toBeNull()
    expect(gitlab?.subBlocks.resetPassword?.value).toBe(true)
    expect(gitlab?.subBlocks.forceRandomPassword?.value).toBe(true)
    expect(gitlab?.data).toEqual({
      userAdminPassword: null,
      resetPassword: true,
      forceRandomPassword: true,
    })
    expect(tools[0].params).toEqual({ resetPassword: true, forceRandomPassword: true })
  })

  it('redacts registered raw-secret fields and reactive credential dependents', () => {
    const secretFields: Array<[string, string, unknown]> = [
      ['ssh', 'privateKey', 'SENTINEL_SSH_PRIVATE_KEY'],
      ['sftp', 'privateKey', 'SENTINEL_SFTP_PRIVATE_KEY'],
      ['pi', 'privateKey', 'SENTINEL_PI_PRIVATE_KEY'],
      ['zoom', 'password', 'SENTINEL_ZOOM_PASSWORD'],
      ['secrets_manager', 'secretValue', 'SENTINEL_SECRET_VALUE'],
      ['browser_use', 'variables', [['API_KEY', 'SENTINEL_BROWSER_VARIABLE']]],
      ['sts', 'webIdentityToken', 'SENTINEL_WEB_IDENTITY_TOKEN'],
      ['sts', 'samlAssertion', 'SENTINEL_SAML_ASSERTION'],
      ['sts', 'tokenCode', 'SENTINEL_TOKEN_CODE'],
      ['discord', 'webhookToken', 'SENTINEL_WEBHOOK_TOKEN'],
      ['codepipeline', 'approvalToken', 'SENTINEL_APPROVAL_TOKEN'],
    ]
    const blocks: Record<string, unknown> = {}
    for (const [index, [type, field, value]] of secretFields.entries()) {
      const id = `${type}-${index}`
      blocks[id] = {
        id,
        type,
        name: type,
        enabled: true,
        subBlocks: { [field]: { id: field, type: 'short-input', value } },
      }
    }
    blocks.google = {
      id: 'google',
      type: 'google_docs',
      name: 'Google Docs',
      enabled: true,
      subBlocks: {
        credential: { id: 'credential', type: 'oauth-input', value: 'SENTINEL_CREDENTIAL' },
        impersonateUserEmail: {
          id: 'impersonateUserEmail',
          type: 'short-input',
          value: 'SENTINEL_IMPERSONATED_EMAIL',
        },
      },
    }

    const sanitized = sanitizeWorkflowForSharing({
      blocks,
      edges: [],
      loops: {},
      parallels: {},
    } as unknown as WorkflowState)

    expect(JSON.stringify(sanitized)).not.toContain('SENTINEL_')
    expect(sanitized.blocks?.google.subBlocks.impersonateUserEmail?.value).toBeNull()
  })

  it('removes Function secret-mount policy from stored Agent tools', () => {
    const state = {
      blocks: {
        agent: {
          id: 'agent',
          type: 'agent',
          name: 'Agent',
          enabled: true,
          subBlocks: {
            tools: {
              id: 'tools',
              type: 'tool-input',
              value: [
                {
                  type: 'function',
                  params: {
                    code: 'return 1',
                    language: 'javascript',
                    secretScope: 'all',
                    mountedSecrets: ['PRIVATE_API_KEY'],
                  },
                },
              ],
            },
          },
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    } as unknown as WorkflowState

    const sanitized = sanitizeWorkflowForSharing(state)
    const tools = sanitized.blocks?.agent.subBlocks.tools?.value as Array<{
      params: Record<string, unknown>
    }>

    expect(tools[0].params).toEqual({ code: 'return 1', language: 'javascript' })
  })
})
