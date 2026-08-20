/**
 * @vitest-environment node
 */
import type { SessionPrincipal, WorkspaceApiKeyPrincipal } from '@sim/auth/principal'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  resolvePermission: vi.fn(),
  allowedIntegrationTypes: vi.fn(),
  getBlockVisibility: vi.fn(),
  listCustomBlocks: vi.fn(),
  isDeploymentAvailable: vi.fn(),
  recordAudit: vi.fn(),
  getAllBlocks: vi.fn(),
  getBlock: vi.fn(),
  getLatestBlockForViewer: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (permission: string | null, required: string) =>
    permission === 'admin' || permission === 'write' || permission === required,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mocks.recordAudit,
  AuditAction: {},
  AuditResourceType: {},
}))

vi.mock('@/lib/integrations/principal-scope.server', () => ({
  allowedIntegrationTypes: mocks.allowedIntegrationTypes,
  principalUserId: (principal: { kind: string; userId?: string }) =>
    principal.kind === 'session' || principal.kind === 'personal_api_key'
      ? principal.userId
      : undefined,
}))

vi.mock('@/lib/core/config/block-visibility', () => ({
  getBlockVisibility: mocks.getBlockVisibility,
}))

vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  listCustomBlocksWithInputsForWorkspace: mocks.listCustomBlocks,
}))

vi.mock('@/lib/integrations/availability.server', () => ({
  isIntegrationDeploymentAvailableForVisibility: mocks.isDeploymentAvailable,
}))

vi.mock('@/blocks/custom/server-overlay', () => ({
  withCustomBlockOverlay: <T>(_rows: unknown, run: () => Promise<T>) => run(),
}))

vi.mock('@/blocks/visibility/server-context', () => ({
  withBlockVisibility: <T>(_state: unknown, run: () => Promise<T>) => run(),
}))

vi.mock('@/blocks/registry', () => ({
  getAllBlocks: mocks.getAllBlocks,
  getBlock: mocks.getBlock,
  getLatestBlockForViewer: mocks.getLatestBlockForViewer,
  getBlockMeta: vi.fn(() => ({ tags: ['messaging'] })),
}))

vi.mock('@/tools/metadata', () => ({
  getToolMetadata: (toolId: string) =>
    Object.hasOwn(TOOL_METADATA, toolId) ? TOOL_METADATA[toolId] : undefined,
}))

vi.mock('@/tools/metadata-outputs', () => ({
  getToolOutputsMetadata: () => ({ ok: { type: 'boolean', description: 'Whether it worked.' } }),
}))

vi.mock('@/tools/tool-ids', () => ({
  getToolIds: () => Object.freeze(Object.keys(TOOL_METADATA)),
  resolveToolId: (toolId: string) => toolId,
}))

import { getCatalogBlock } from '@/lib/catalog/application/get-block'
import { getCatalogTool } from '@/lib/catalog/application/get-tool'
import { listCatalogBlocks } from '@/lib/catalog/application/list-blocks'
import { listCatalogTools } from '@/lib/catalog/application/list-tools'
import type { BlockConfig } from '@/blocks/types'

const TOOL_METADATA: Record<string, Record<string, unknown>> = {
  slack_message: {
    id: 'slack_message',
    name: 'Slack Send Message',
    description: 'Send a message.',
    version: '1.0.0',
    params: { text: { type: 'string', required: true } },
    hostedApiKey: 'none',
    oauth: { required: true, provider: 'slack' },
  },
  preview_call: {
    id: 'preview_call',
    name: 'Preview Call',
    description: 'Call the preview service.',
    version: '1.0.0',
    params: {},
    hostedApiKey: 'always',
  },
}

const WORKSPACE_ID = 'workspace-1'

const workspaceContext = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: 'org-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const session: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const workspaceKey: WorkspaceApiKeyPrincipal = {
  kind: 'workspace_api_key',
  workspaceId: WORKSPACE_ID,
  keyId: 'key-1',
}

function block(overrides: Partial<BlockConfig> & { type: string }): BlockConfig {
  return {
    name: overrides.type,
    description: `${overrides.type} block`,
    category: 'tools',
    bgColor: '#000000',
    icon: (() => null) as unknown as BlockConfig['icon'],
    subBlocks: [],
    tools: { access: [] },
    inputs: {},
    outputs: {},
    ...overrides,
  } as BlockConfig
}

const slackBlock = block({
  type: 'slack',
  name: 'Slack',
  description: 'Send messages in Slack.',
  triggerAllowed: true,
  subBlocks: [
    {
      id: 'operation',
      type: 'dropdown',
      title: 'Operation',
      options: [{ id: 'send', label: 'Send message' }],
    },
    {
      id: 'text',
      type: 'long-input',
      title: 'Message',
      condition: { field: 'operation', value: 'send' },
    },
  ],
  tools: {
    access: ['slack_message'],
    config: { tool: () => 'slack_message' },
  },
})
const notionBlock = block({ type: 'notion', name: 'Notion', description: 'Read Notion pages.' })
const previewBlock = block({
  type: 'preview_thing',
  name: 'Preview thing',
  preview: true,
  tools: { access: ['preview_call'] },
})
const customBlock = block({
  type: 'custom_block_reports',
  name: 'Reports',
  description: 'Run the reports workflow.',
})
/** A superseded version: present in the registry, hidden from every discovery surface. */
const confluenceV1 = block({
  type: 'confluence',
  name: 'Confluence',
  hideFromToolbar: true,
})
const confluenceV2 = block({
  type: 'confluence_v2',
  name: 'Confluence',
  description: 'Read Confluence pages.',
})

interface Visibility {
  revealed: Set<string>
  disabled: Set<string>
  previewTagged: Set<string>
}

const NOTHING_GATED: Visibility = {
  revealed: new Set<string>(),
  disabled: new Set<string>(),
  previewTagged: new Set<string>(),
}

/** The visibility document both the gate and the registry stub below resolve against. */
let visibility: Visibility = NOTHING_GATED

function setVisibility(state: Visibility): void {
  visibility = state
  mocks.getBlockVisibility.mockResolvedValue(state)
}

/**
 * Stands in for `getLatestBlockForViewer`: resolves an unversioned base type to
 * its highest version and applies the list's " (Preview)" display suffix. Those
 * are exactly the two behaviours the detail read used to lack, so the stub has
 * to reproduce them or the tests below would pass against the old `getBlock`.
 */
function resolveLatestForViewer(type: string, registry: BlockConfig[]): BlockConfig | undefined {
  const versionPattern = new RegExp(`^${type}_v(\\d+)$`)
  const latestVersioned = registry
    .filter((entry) => versionPattern.test(entry.type))
    .sort((left, right) => left.type.localeCompare(right.type))
    .at(-1)
  const block = latestVersioned ?? registry.find((entry) => entry.type === type)
  if (!block) return undefined
  return block.preview && visibility.previewTagged.has(block.type)
    ? { ...block, name: `${block.name} (Preview)` }
    : block
}

const listInput = {
  workspaceId: WORKSPACE_ID,
  sortBy: 'id' as const,
  sortOrder: 'asc' as const,
  offset: 0,
  limit: 50,
}

describe('catalog block and tool reads', () => {
  afterAll(resetEnvFlagsMock)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('read')
    mocks.allowedIntegrationTypes.mockResolvedValue(null)
    setVisibility(NOTHING_GATED)
    mocks.listCustomBlocks.mockResolvedValue([])
    mocks.isDeploymentAvailable.mockReturnValue(true)
    setEnvFlags({ isHosted: true })
    mocks.getAllBlocks.mockReturnValue([slackBlock, notionBlock, customBlock])
    /** `isBlockTypeAccessControlExempt` reads the pure registry lookup. */
    mocks.getBlock.mockImplementation((type: string) =>
      [slackBlock, notionBlock, previewBlock, customBlock].find((entry) => entry.type === type)
    )
    mocks.getLatestBlockForViewer.mockImplementation((type: string) =>
      resolveLatestForViewer(type, [
        slackBlock,
        notionBlock,
        previewBlock,
        customBlock,
        confluenceV1,
        confluenceV2,
      ])
    )
  })

  it('lists blocks for a session principal and records no audit', async () => {
    const result = await listCatalogBlocks.execute({ principal: session, input: listInput })

    expect(result.entries.map((entry) => entry.id)).toEqual([
      'custom_block_reports',
      'notion',
      'slack',
    ])
    expect(result.hasMore).toBe(false)
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it('accepts a workspace API key, which has no user for permission groups to key on', async () => {
    const result = await listCatalogBlocks.execute({ principal: workspaceKey, input: listInput })

    expect(result.entries).toHaveLength(3)
    expect(mocks.allowedIntegrationTypes).toHaveBeenCalledWith(workspaceKey, WORKSPACE_ID)
    expect(mocks.getBlockVisibility).toHaveBeenCalledWith({ orgId: 'org-1' })
  })

  it('resolves block visibility for the acting user and their organization', async () => {
    await listCatalogBlocks.execute({ principal: session, input: listInput })

    expect(mocks.getBlockVisibility).toHaveBeenCalledWith({ userId: 'user-1', orgId: 'org-1' })
  })

  it('discriminates a workspace custom block from a shipped one', async () => {
    const result = await listCatalogBlocks.execute({ principal: session, input: listInput })

    const sources = Object.fromEntries(result.entries.map((entry) => [entry.id, entry.source]))
    expect(sources).toEqual({
      custom_block_reports: 'custom',
      notion: 'builtin',
      slack: 'builtin',
    })
  })

  it('answers not found for a workspace the caller cannot reach', async () => {
    mocks.loadWorkspace.mockResolvedValue(null)

    await expect(
      listCatalogBlocks.execute({ principal: session, input: listInput })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Workspace not found' })
  })

  it('propagates an integration-allowlist infrastructure failure instead of concealing it', async () => {
    mocks.allowedIntegrationTypes.mockRejectedValue(new Error('permission store unavailable'))

    await expect(
      listCatalogBlocks.execute({ principal: session, input: listInput })
    ).rejects.toThrow('permission store unavailable')
  })

  it('hides an unrevealed preview block from the list and from its detail read', async () => {
    mocks.getAllBlocks.mockReturnValue([slackBlock, previewBlock])

    const result = await listCatalogBlocks.execute({ principal: session, input: listInput })
    expect(result.entries.map((entry) => entry.id)).toEqual(['slack'])

    await expect(
      getCatalogBlock.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, blockId: 'preview_thing' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Block not found' })
  })

  it('reveals a preview block once the visibility document names it', async () => {
    mocks.getAllBlocks.mockReturnValue([slackBlock, previewBlock])
    setVisibility({
      revealed: new Set(['preview_thing']),
      disabled: new Set<string>(),
      previewTagged: new Set(['preview_thing']),
    })

    const result = await listCatalogBlocks.execute({ principal: session, input: listInput })
    expect(result.entries.map((entry) => entry.id)).toContain('preview_thing')
  })

  it('drops a kill-switched block from the list and 404s its detail', async () => {
    setVisibility({
      revealed: new Set<string>(),
      disabled: new Set(['notion']),
      previewTagged: new Set<string>(),
    })

    const result = await listCatalogBlocks.execute({ principal: session, input: listInput })
    expect(result.entries.map((entry) => entry.id)).not.toContain('notion')

    await expect(
      getCatalogBlock.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, blockId: 'notion' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Block not found' })
  })

  it('drops a block the permission-group allowlist excludes, from list and detail alike', async () => {
    mocks.allowedIntegrationTypes.mockResolvedValue(new Set(['slack']))

    const result = await listCatalogBlocks.execute({ principal: session, input: listInput })
    expect(result.entries.map((entry) => entry.id)).toEqual(['slack'])

    await expect(
      getCatalogBlock.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, blockId: 'notion' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('drops a block this deployment does not ship', async () => {
    mocks.isDeploymentAvailable.mockImplementation((type: string) => type !== 'notion')

    const result = await listCatalogBlocks.execute({ principal: session, input: listInput })
    expect(result.entries.map((entry) => entry.id)).toEqual(['custom_block_reports', 'slack'])
  })

  it('narrows to trigger-capable blocks without a second endpoint', async () => {
    const result = await listCatalogBlocks.execute({
      principal: session,
      input: { ...listInput, capability: 'trigger' },
    })

    expect(result.entries.map((entry) => entry.id)).toEqual(['slack'])
  })

  it('rejects a blank search rather than silently matching everything', async () => {
    await expect(
      listCatalogBlocks.execute({ principal: session, input: { ...listInput, search: '   ' } })
    ).rejects.toMatchObject({ code: 'validation', message: 'search cannot be empty' })
  })

  it('pages the sorted sequence and reports whether more remain', async () => {
    const first = await listCatalogBlocks.execute({
      principal: session,
      input: { ...listInput, limit: 2 },
    })
    expect(first.entries.map((entry) => entry.id)).toEqual(['custom_block_reports', 'notion'])
    expect(first.hasMore).toBe(true)

    const second = await listCatalogBlocks.execute({
      principal: session,
      input: { ...listInput, limit: 2, offset: 2 },
    })
    expect(second.entries.map((entry) => entry.id)).toEqual(['slack'])
    expect(second.hasMore).toBe(false)
  })

  it('reads one block with its operations and tools resolved from metadata', async () => {
    const { block: detail } = await getCatalogBlock.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, blockId: 'slack' },
    })

    expect(detail.id).toBe('slack')
    expect(detail.tools.map((tool) => tool.id)).toEqual(['slack_message'])
    expect(detail.tools[0].params).toEqual({ text: { type: 'string', required: true } })

    /**
     * The operation's inputs come from the generated tool metadata, not the
     * executable registry — that substitution is the whole point of the shared
     * projection, so it is pinned rather than assumed.
     */
    expect(detail.operationIds).toEqual(['send'])
    expect(detail.operations.send.toolId).toBe('slack_message')
    expect(detail.operations.send.inputs).toEqual({ text: { type: 'string', required: true } })
    expect(detail.operations.send.outputs).toEqual({
      ok: { type: 'boolean', description: 'Whether it worked.' },
    })
    expect(detail.operationInputSchema.send.map((field) => field.id)).toEqual(['text'])
  })

  it('lists only the tools a visible block exposes', async () => {
    mocks.getAllBlocks.mockReturnValue([slackBlock, previewBlock])

    const result = await listCatalogTools.execute({ principal: session, input: listInput })

    expect(result.entries.map((entry) => entry.id)).toEqual(['slack_message'])
  })

  it('filters tools by how their API key is supplied', async () => {
    mocks.getAllBlocks.mockReturnValue([slackBlock, previewBlock])
    setVisibility({
      revealed: new Set(['preview_thing']),
      disabled: new Set<string>(),
      previewTagged: new Set<string>(),
    })

    const hosted = await listCatalogTools.execute({
      principal: session,
      input: { ...listInput, hostedApiKey: 'always' },
    })
    expect(hosted.entries.map((entry) => entry.id)).toEqual(['preview_call'])

    const byProvider = await listCatalogTools.execute({
      principal: session,
      input: { ...listInput, oauthProvider: 'SLACK' },
    })
    expect(byProvider.entries.map((entry) => entry.id)).toEqual(['slack_message'])
  })

  it('answers not found for an unknown tool and for one no visible block exposes', async () => {
    await expect(
      getCatalogTool.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, toolId: 'nope_missing' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Tool not found' })

    mocks.getAllBlocks.mockReturnValue([slackBlock])
    await expect(
      getCatalogTool.execute({
        principal: session,
        input: { workspaceId: WORKSPACE_ID, toolId: 'preview_call' },
      })
    ).rejects.toMatchObject({ code: 'not_found', message: 'Tool not found' })
  })

  /**
   * The list projects through the viewer's visibility, which renames a revealed
   * preview block; the detail read used a bare registry lookup, which does not.
   * A caller reading `GET /v2/blocks/preview_thing` after seeing it in the list
   * got a different `name` for the same block.
   */
  it('names a revealed preview block identically in the list and its detail', async () => {
    mocks.getAllBlocks.mockReturnValue([
      slackBlock,
      { ...previewBlock, name: `${previewBlock.name} (Preview)` },
    ])
    setVisibility({
      revealed: new Set(['preview_thing']),
      disabled: new Set<string>(),
      previewTagged: new Set(['preview_thing']),
    })

    const listed = await listCatalogBlocks.execute({ principal: session, input: listInput })
    const summary = listed.entries.find((entry) => entry.id === 'preview_thing')

    const { block: detail } = await getCatalogBlock.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, blockId: 'preview_thing' },
    })

    expect(detail.name).toBe('Preview thing (Preview)')
    expect(detail.name).toBe(summary?.name)
  })

  /**
   * Every versioned family's base type resolves to the superseded v1, which
   * carries `hideFromToolbar` — so `GET /v2/blocks/confluence` 404'd while the
   * list contained `confluence_v2`.
   */
  it('resolves an unversioned block name to its newest version and echoes the resolved id', async () => {
    mocks.getAllBlocks.mockReturnValue([confluenceV2])

    const { block: detail } = await getCatalogBlock.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, blockId: 'confluence' },
    })

    expect(detail.id).toBe('confluence_v2')
  })

  it('orders by code unit rather than the process locale', async () => {
    mocks.getAllBlocks.mockReturnValue([
      block({ type: 'b_lower', name: 'apple' }),
      block({ type: 'a_upper', name: 'Banana' }),
    ])

    const result = await listCatalogBlocks.execute({
      principal: session,
      input: { ...listInput, sortBy: 'name' },
    })

    /**
     * `'Banana'.localeCompare('apple')` is negative under an en locale and
     * positive by code unit. Pinning the code-unit answer is what makes an
     * offset cursor name the same row on every instance, whatever its `LANG`.
     */
    expect(result.entries.map((entry) => entry.name)).toEqual(['Banana', 'apple'])
  })

  it('reports no hosted key on a deployment that supplies none', async () => {
    mocks.getAllBlocks.mockReturnValue([slackBlock, previewBlock])
    setVisibility({
      revealed: new Set(['preview_thing']),
      disabled: new Set<string>(),
      previewTagged: new Set<string>(),
    })
    setEnvFlags({ isHosted: false })

    const { tool } = await getCatalogTool.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, toolId: 'preview_call' },
    })
    expect(tool.hostedApiKey).toBe('none')

    const listed = await listCatalogTools.execute({ principal: session, input: listInput })
    expect(listed.entries.map((entry) => entry.hostedApiKey)).toEqual(['none', 'none'])
  })

  it('reads one tool with its params and outputs', async () => {
    const { tool } = await getCatalogTool.execute({
      principal: session,
      input: { workspaceId: WORKSPACE_ID, toolId: 'slack_message' },
    })

    expect(tool.id).toBe('slack_message')
    expect(tool.outputs).toEqual({ ok: { type: 'boolean', description: 'Whether it worked.' } })
  })
})
