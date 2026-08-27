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
const NAMES: Record<string, string> = { 'cred-a': 'Support Inbox', 'cred-b': 'Billing Inbox' }

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

const account = (id: string): ToolPinnedField => ({
  title: 'Gmail Account',
  resource: { kind: 'credential', id },
})

const label = (value: string): ToolPinnedField => ({ title: 'Label', value })

const ctx = (cache?: Map<string, string | null>) => ({
  workspaceId: WORKSPACE_ID,
  toolBindingLabelCache: cache,
})

/** Text appended after the base description, or '' when nothing was appended. */
const appended = (tool: ProviderToolConfig) => tool.description.slice(BASE.length).trim()

describe('annotateToolPinnedParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetKnowledgeBaseNames.mockResolvedValue(new Map())
    mockFindWorkspaceCredentialLookup.mockImplementation(async ({ credentialId }) =>
      NAMES[credentialId] ? { id: credentialId, displayName: NAMES[credentialId] } : null
    )
  })

  it('distinguishes two copies that share a credential but differ by folder', async () => {
    const inbox = providerTool('gmail_read_email', [account('cred-a'), label('INBOX')])
    const sent = providerTool('gmail_read_email', [account('cred-a'), label('SENT')])

    await annotateToolPinnedParams(ctx(), [inbox, sent])

    expect(appended(inbox)).toContain('Gmail Account "Support Inbox", Label "INBOX".')
    expect(appended(sent)).toContain('Gmail Account "Support Inbox", Label "SENT".')
    expect(appended(inbox)).toContain('Other copies of this tool')
  })

  it('does not claim copies differ when they render identically', async () => {
    const first = providerTool('gmail_read_email', [account('cred-a'), label('INBOX')])
    const second = providerTool('gmail_read_email', [account('cred-a'), label('INBOX')])

    await annotateToolPinnedParams(ctx(), [first, second])

    expect(appended(first)).toContain('Label "INBOX".')
    expect(appended(first)).not.toContain('Other copies')
    expect(appended(second)).not.toContain('Other copies')
  })

  it('states pinned params on a single tool so the model knows what it cannot change', async () => {
    const only = providerTool('gmail_read_email', [label('INBOX')])

    await annotateToolPinnedParams(ctx(), [only])

    expect(appended(only)).toBe(
      'Pinned by the workflow and not changeable per call: Label "INBOX".'
    )
  })

  it('leaves a tool with no pinned fields untouched and issues no lookup', async () => {
    const bare = providerTool('gmail_read_email')

    await annotateToolPinnedParams(ctx(), [bare])

    expect(bare.description).toBe(BASE)
    expect(mockFindWorkspaceCredentialLookup).not.toHaveBeenCalled()
  })

  it('resolves an opaque credential id to its name without leaking the id', async () => {
    const first = providerTool('gmail_read_email', [account('cred-a')])
    const second = providerTool('gmail_read_email', [account('cred-b')])

    await annotateToolPinnedParams(ctx(), [first, second])

    expect(appended(first)).toContain('Gmail Account "Support Inbox"')
    expect(appended(second)).toContain('Gmail Account "Billing Inbox"')
    expect(first.description).not.toContain('cred-a')
    expect(second.description).not.toContain('cred-b')
  })

  it('omits an unresolvable resource but still states the other fields', async () => {
    const tool = providerTool('gmail_read_email', [account('cred-deleted'), label('INBOX')])

    await annotateToolPinnedParams(ctx(), [tool])

    expect(appended(tool)).toContain('Label "INBOX".')
    expect(appended(tool)).not.toContain('Gmail Account')
    expect(tool.description).not.toContain('cred-deleted')
  })

  it('withholds literal values for a tool whose params resolved a secret', async () => {
    const tool = providerTool('gmail_read_email', [account('cred-a'), label('SecretFolder')])

    await annotateToolPinnedParams(ctx(), [tool], () => true)

    expect(appended(tool)).toContain('Gmail Account "Support Inbox".')
    expect(tool.description).not.toContain('SecretFolder')
  })

  it('adds nothing when every field of a secret-bearing tool is a literal', async () => {
    const tool = providerTool('gmail_read_email', [label('SecretFolder')])

    await annotateToolPinnedParams(ctx(), [tool], () => true)

    expect(tool.description).toBe(BASE)
  })

  it('degrades to no resource name when a resolver throws', async () => {
    mockFindWorkspaceCredentialLookup.mockRejectedValue(new Error('db down'))
    const tool = providerTool('gmail_read_email', [account('cred-a'), label('INBOX')])

    await expect(annotateToolPinnedParams(ctx(), [tool])).resolves.toBeUndefined()

    expect(appended(tool)).toContain('Label "INBOX".')
    expect(appended(tool)).not.toContain('Gmail Account')
  })

  it('omits a knowledge base belonging to another workspace', async () => {
    mockGetKnowledgeBaseNames.mockResolvedValue(new Map([['kb-a', 'Support Docs']]))
    const foreign = providerTool('knowledge_search', [
      { title: 'Knowledge Base', resource: { kind: 'knowledgeBase', id: 'kb-foreign' } },
    ])

    await annotateToolPinnedParams(ctx(), [foreign])

    expect(foreign.description).toBe(BASE)
    expect(mockGetKnowledgeBaseNames).toHaveBeenCalledWith(['kb-foreign'], WORKSPACE_ID)
  })

  it('caps how many fields it states', async () => {
    const tool = providerTool(
      'gmail_read_email',
      Array.from({ length: 10 }, (_, index) => ({ title: `F${index}`, value: index }))
    )

    await annotateToolPinnedParams(ctx(), [tool])

    expect(appended(tool)).toContain('F0 0, F1 1, F2 2.')
    expect(appended(tool)).not.toContain('F3')
  })

  it('resolves each distinct credential once and reuses the run cache', async () => {
    const cache = new Map<string, string | null>()
    const build = () => [
      providerTool('gmail_read_email', [account('cred-a')]),
      providerTool('gmail_send', [account('cred-a')]),
    ]

    await annotateToolPinnedParams(ctx(cache), build())
    expect(mockFindWorkspaceCredentialLookup).toHaveBeenCalledTimes(1)

    const second = build()
    await annotateToolPinnedParams(ctx(cache), second)

    expect(mockFindWorkspaceCredentialLookup).toHaveBeenCalledTimes(1)
    expect(appended(second[0])).toContain('Gmail Account "Support Inbox"')
  })

  it('does nothing without a workspace', async () => {
    const tool = providerTool('gmail_read_email', [label('INBOX')])

    await annotateToolPinnedParams({ workspaceId: undefined }, [tool])

    expect(tool.description).toBe(BASE)
  })
})
