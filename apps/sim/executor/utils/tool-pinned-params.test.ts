/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFindWorkspaceCredentialLookup, mockGetKnowledgeBaseNames } = vi.hoisted(() => ({
  mockFindWorkspaceCredentialLookup: vi.fn(),
  mockGetKnowledgeBaseNames: vi.fn(),
}))

vi.mock('@/lib/credentials/queries', () => ({
  findWorkspaceCredentialLookup: mockFindWorkspaceCredentialLookup,
}))

vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseNames: mockGetKnowledgeBaseNames,
}))

import { annotateToolPinnedParams } from '@/executor/utils/tool-pinned-params'
import { registerToolPinnedFields, type ToolPinnedField } from '@/providers/tool-binding'
import type { ProviderToolConfig } from '@/providers/types'

const WORKSPACE_ID = 'workspace-1'
const BASE = 'Read emails from Gmail'

function providerTool(id: string, fields: ToolPinnedField[] = []): ProviderToolConfig {
  const tool: ProviderToolConfig = {
    id,
    description: BASE,
    params: {},
    parameters: { type: 'object', properties: {}, required: [] },
  }
  registerToolPinnedFields(tool, fields)
  return tool
}

const credentialField = (id: string): ToolPinnedField => ({
  paramId: 'oauthCredential',
  title: 'Gmail Account',
  resource: { kind: 'credential', id },
})

const folderField = (value: string): ToolPinnedField => ({
  paramId: 'folder',
  title: 'Label',
  value,
  quoted: true,
})

function ctx(cache?: Map<string, string | null>) {
  return { workspaceId: WORKSPACE_ID, toolBindingLabelCache: cache }
}

function credentialsByName(names: Record<string, string>) {
  return async ({ credentialId }: { credentialId: string }) =>
    names[credentialId] ? { id: credentialId, displayName: names[credentialId] } : null
}

describe('annotateToolPinnedParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKnowledgeBaseNames.mockResolvedValue(new Map())
    mockFindWorkspaceCredentialLookup.mockImplementation(
      credentialsByName({ 'cred-a': 'Support Inbox', 'cred-b': 'Billing Inbox' })
    )
  })

  it('distinguishes two copies that share a credential but differ by folder', async () => {
    const inbox = providerTool('gmail_read_email', [
      credentialField('cred-a'),
      folderField('INBOX'),
    ])
    const sent = providerTool('gmail_read_email', [credentialField('cred-a'), folderField('SENT')])

    await annotateToolPinnedParams(ctx(), [inbox, sent])

    expect(inbox.description).toContain('Gmail Account "Support Inbox", Label "INBOX".')
    expect(sent.description).toContain('Gmail Account "Support Inbox", Label "SENT".')
    expect(inbox.description).toContain('This agent has 2 copies of this tool')
    expect(inbox.description).not.toBe(sent.description)
  })

  it('states pinned params on a single tool so the model knows what it cannot change', async () => {
    const only = providerTool('gmail_read_email', [folderField('INBOX')])

    await annotateToolPinnedParams(ctx(), [only])

    expect(only.description).toContain('Pinned by the workflow and not changeable per call')
    expect(only.description).toContain('Label "INBOX".')
    expect(only.description).not.toContain('copies of this tool')
  })

  it('leaves a tool with no pinned fields untouched and issues no lookup', async () => {
    const bare = providerTool('gmail_read_email')

    await annotateToolPinnedParams(ctx(), [bare])

    expect(bare.description).toBe(BASE)
    expect(mockFindWorkspaceCredentialLookup).not.toHaveBeenCalled()
  })

  it('resolves an opaque credential id to its display name without leaking the id', async () => {
    const first = providerTool('gmail_read_email', [credentialField('cred-a')])
    const second = providerTool('gmail_read_email', [credentialField('cred-b')])

    await annotateToolPinnedParams(ctx(), [first, second])

    expect(first.description).toContain('Gmail Account "Support Inbox"')
    expect(second.description).toContain('Gmail Account "Billing Inbox"')
    expect(first.description).not.toContain('cred-a')
    expect(second.description).not.toContain('cred-b')
  })

  it('omits an unresolvable resource but still states the other fields', async () => {
    const tool = providerTool('gmail_read_email', [
      credentialField('cred-deleted'),
      folderField('INBOX'),
    ])

    await annotateToolPinnedParams(ctx(), [tool])

    expect(tool.description).toContain('Label "INBOX".')
    expect(tool.description).not.toContain('Gmail Account')
    expect(tool.description).not.toContain('cred-deleted')
  })

  it('withholds literal values for a tool whose params resolved a secret', async () => {
    const tool = providerTool('gmail_read_email', [
      credentialField('cred-a'),
      folderField('SecretFolderName'),
    ])

    await annotateToolPinnedParams(ctx(), [tool], { hasResolvedSecretInputs: () => true })

    expect(tool.description).toContain('Gmail Account "Support Inbox".')
    expect(tool.description).not.toContain('SecretFolderName')
  })

  it('adds nothing at all when every field of a secret-bearing tool is a literal', async () => {
    const tool = providerTool('gmail_read_email', [folderField('SecretFolderName')])

    await annotateToolPinnedParams(ctx(), [tool], { hasResolvedSecretInputs: () => true })

    expect(tool.description).toBe(BASE)
  })

  it('degrades to no resource name when a resolver throws', async () => {
    mockFindWorkspaceCredentialLookup.mockRejectedValue(new Error('db down'))
    const tool = providerTool('gmail_read_email', [credentialField('cred-a'), folderField('INBOX')])

    await expect(annotateToolPinnedParams(ctx(), [tool])).resolves.toBeUndefined()

    expect(tool.description).toContain('Label "INBOX".')
    expect(tool.description).not.toContain('Gmail Account')
  })

  it('omits a knowledge base belonging to another workspace', async () => {
    mockGetKnowledgeBaseNames.mockResolvedValue(new Map([['kb-a', 'Support Docs']]))
    const foreign = providerTool('knowledge_search', [
      {
        paramId: 'knowledgeBaseId',
        title: 'Knowledge Base',
        resource: { kind: 'knowledgeBase', id: 'kb-foreign' },
      },
    ])

    await annotateToolPinnedParams(ctx(), [foreign])

    expect(foreign.description).toBe(BASE)
    expect(mockGetKnowledgeBaseNames).toHaveBeenCalledWith(['kb-foreign'], WORKSPACE_ID)
  })

  it('caps how many fields it states', async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      paramId: `p${index}`,
      title: `Field ${index}`,
      value: String(index),
      quoted: false,
    }))
    const tool = providerTool('gmail_read_email', many)

    await annotateToolPinnedParams(ctx(), [tool])

    expect(tool.description).toContain('Field 5 5.')
    expect(tool.description).not.toContain('Field 6')
  })

  it('resolves each distinct credential once and reuses the run cache', async () => {
    const cache = new Map<string, string | null>()
    const build = () => [
      providerTool('gmail_read_email', [credentialField('cred-a')]),
      providerTool('gmail_send', [credentialField('cred-a')]),
    ]

    await annotateToolPinnedParams(ctx(cache), build())
    expect(mockFindWorkspaceCredentialLookup).toHaveBeenCalledTimes(1)

    const second = build()
    await annotateToolPinnedParams(ctx(cache), second)

    expect(mockFindWorkspaceCredentialLookup).toHaveBeenCalledTimes(1)
    expect(second[0].description).toContain('Gmail Account "Support Inbox"')
  })

  it('does nothing without a workspace', async () => {
    const tool = providerTool('gmail_read_email', [folderField('INBOX')])

    await annotateToolPinnedParams({ workspaceId: undefined }, [tool])

    expect(tool.description).toBe(BASE)
  })

  it('annotates the exact objects it was given', async () => {
    const tools = [
      providerTool('gmail_read_email', [folderField('INBOX')]),
      providerTool('gmail_read_email', [folderField('SENT')]),
    ]
    const [first, second] = tools

    await annotateToolPinnedParams(ctx(), tools)

    expect(tools[0]).toBe(first)
    expect(tools[1]).toBe(second)
  })
})
