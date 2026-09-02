/**
 * @vitest-environment node
 */
import type { PersonalApiKeyPrincipal, WorkspaceApiKeyPrincipal } from '@sim/auth/principal'
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
  executeRegistryTool: vi.fn(),
  resolveBillingAttribution: vi.fn(),
  recordUsage: vi.fn(),
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
  getBlock: vi.fn(),
  getLatestBlockForViewer: vi.fn(),
  getBlockMeta: vi.fn(() => ({ tags: [] })),
}))

vi.mock('@/tools/utils', () => ({
  getTool: (toolId: string) =>
    Object.hasOwn(TOOL_METADATA, toolId) ? TOOL_METADATA[toolId] : undefined,
}))

vi.mock('@/tools/tool-ids', () => ({
  getToolIds: () => Object.freeze(Object.keys(TOOL_METADATA)),
  resolveToolId: (toolId: string) => toolId,
}))

vi.mock('@/tools', () => ({ executeTool: mocks.executeRegistryTool }))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mocks.resolveBillingAttribution,
  toBillingContext: () => ({
    billingEntity: { type: 'workspace', id: WORKSPACE_ID },
    billingPeriod: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
  }),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({ recordUsage: mocks.recordUsage }))

import { executeToolForCaller } from '@/lib/tool-execution/application/execute-tool'
import type { BlockConfig } from '@/blocks/types'

const TOOL_METADATA: Record<string, Record<string, unknown>> = {
  slack_message: {
    id: 'slack_message',
    name: 'Slack Send Message',
    params: {
      accessToken: { type: 'string', required: true, visibility: 'hidden' },
      text: { type: 'string', required: true, visibility: 'user-or-llm' },
    },
    oauth: { required: true, provider: 'slack' },
  },
  firecrawl_scrape: {
    id: 'firecrawl_scrape',
    name: 'Firecrawl Scrape',
    params: {
      url: { type: 'string', required: true, visibility: 'user-or-llm' },
      apiKey: { type: 'string', required: true, visibility: 'user-only' },
    },
    hosting: { apiKeyParam: 'apiKey' },
  },
  snowflake_execute_sql: {
    id: 'snowflake_execute_sql',
    name: 'Snowflake Execute SQL',
    params: {
      oauthCredential: { type: 'string', required: true, visibility: 'user-only' },
      statement: { type: 'string', required: true, visibility: 'user-or-llm' },
    },
  },
  thinking_tool: {
    id: 'thinking_tool',
    name: 'Thinking',
    params: { thought: { type: 'string', required: true, visibility: 'llm-only' } },
  },
  zendesk_get_ticket: {
    id: 'zendesk_get_ticket',
    name: 'Zendesk Get Ticket',
    params: {
      subdomain: { type: 'string', required: true, visibility: 'user-only' },
      apiToken: { type: 'string', required: true, visibility: 'user-only' },
      ticketId: { type: 'string', required: true, visibility: 'user-or-llm' },
    },
  },
  preview_call: { id: 'preview_call', name: 'Preview Call', params: {} },
  confluence_read_v2: { id: 'confluence_read_v2', name: 'Confluence Read', params: {} },
}

const WORKSPACE_ID = 'workspace-1'

const workspaceContext = {
  workspaceId: WORKSPACE_ID,
  workspaceOrganizationId: 'org-1',
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner-1',
}

const principal: PersonalApiKeyPrincipal = {
  kind: 'personal_api_key',
  userId: 'user-1',
  keyId: 'key-1',
}
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

const slackBlock = block({ type: 'slack', tools: { access: ['slack_message'] } })
const firecrawlBlock = block({ type: 'firecrawl', tools: { access: ['firecrawl_scrape'] } })
const previewBlock = block({
  type: 'preview_thing',
  preview: true,
  tools: { access: ['preview_call'] },
})
const zendeskBlock = block({ type: 'zendesk', tools: { access: ['zendesk_get_ticket'] } })
const thinkingBlock = block({ type: 'thinking', tools: { access: ['thinking_tool'] } })
const snowflakeBlock = block({ type: 'snowflake', tools: { access: ['snowflake_execute_sql'] } })
const confluenceBlock = block({
  type: 'confluence_v2',
  tools: { access: ['confluence_read_v2'] },
})

function run(input: Partial<Parameters<typeof executeToolForCaller.execute>[0]['input']> = {}) {
  return executeToolForCaller.execute({
    principal,
    input: {
      workspaceId: WORKSPACE_ID,
      toolId: 'firecrawl_scrape',
      input: { url: 'https://example.com' },
      ...input,
    },
  })
}

describe('executeToolForCaller', () => {
  afterAll(resetEnvFlagsMock)

  beforeEach(() => {
    vi.clearAllMocks()
    // Hosted-key injection only happens where Sim hosts keys.
    setEnvFlags({ isHosted: true })
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.allowedIntegrationTypes.mockResolvedValue(null)
    mocks.getBlockVisibility.mockResolvedValue({ revealed: new Set(), disabled: new Set() })
    mocks.listCustomBlocks.mockResolvedValue([])
    mocks.isDeploymentAvailable.mockReturnValue(true)
    mocks.getAllBlocks.mockReturnValue([
      slackBlock,
      firecrawlBlock,
      previewBlock,
      confluenceBlock,
      zendeskBlock,
      thinkingBlock,
      snowflakeBlock,
    ])
    mocks.executeRegistryTool.mockResolvedValue({ success: true, output: { markdown: '# Hi' } })
    mocks.resolveBillingAttribution.mockResolvedValue({ workspaceId: WORKSPACE_ID })
  })

  it('runs a visible, permitted tool and reports what it produced', async () => {
    await expect(run({ input: { url: 'https://example.com' } })).resolves.toEqual({
      toolId: 'firecrawl_scrape',
      status: 'succeeded',
      output: { markdown: '# Hi' },
      error: null,
    })
  })

  it('acts as the authenticated caller and enforces credential access', async () => {
    await run({ input: { url: 'https://example.com' } })

    const [, params] = mocks.executeRegistryTool.mock.calls[0]
    expect(params._context).toMatchObject({
      userId: 'user-1',
      workspaceId: WORKSPACE_ID,
      enforceCredentialAccess: true,
    })
  })

  /**
   * The bare-name form Copilot also accepts would read an identifier-shaped
   * literal secret as a variable lookup. A caller that types the value gets the
   * explicit form only.
   */
  it('resolves only explicit environment-variable references', async () => {
    await run({ input: { url: 'https://example.com' } })

    const [, params] = mocks.executeRegistryTool.mock.calls[0]
    expect(params._context.envReferenceMode).toBe('explicit')
  })

  it('conceals a tool no visible block exposes as absent', async () => {
    await expect(run({ toolId: 'preview_call' })).rejects.toMatchObject({
      code: 'not_found',
      message: 'Tool not found',
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  it('conceals a tool that is in no block at all', async () => {
    await expect(run({ toolId: 'not_a_tool' })).rejects.toMatchObject({ code: 'not_found' })
  })

  /**
   * A denied integration is a decision an admin made and can reverse, and the
   * built-in catalog is public — so it is named rather than concealed, unlike
   * the unrevealed preview above.
   */
  it('refuses an integration the workspace does not permit, naming the cause', async () => {
    mocks.allowedIntegrationTypes.mockResolvedValue(new Set(['slack']))

    await expect(run({ toolId: 'firecrawl_scrape' })).rejects.toMatchObject({
      code: 'forbidden',
      detailCode: 'INTEGRATION_NOT_ALLOWED',
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  it('still runs a permitted integration when an allowlist is set', async () => {
    mocks.allowedIntegrationTypes.mockResolvedValue(new Set(['firecrawl']))

    await expect(run({ toolId: 'firecrawl_scrape' })).resolves.toMatchObject({
      status: 'succeeded',
    })
  })

  it('resolves an unversioned name to the newest visible version', async () => {
    await expect(run({ toolId: 'confluence_read', input: {} })).resolves.toMatchObject({
      toolId: 'confluence_read_v2',
    })
  })

  /**
   * The workflow path validates `user-only` parameters during serialization.
   * This path has no serialization step, so without an explicit check a missing
   * credential reached the provider as `undefined`.
   */
  it('refuses a missing required user-only input, naming every one of them', async () => {
    await expect(
      run({ toolId: 'zendesk_get_ticket', input: { ticketId: '42' } })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('input.subdomain'),
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  it('names the missing inputs together rather than one per round trip', async () => {
    await expect(
      run({ toolId: 'zendesk_get_ticket', input: { ticketId: '42' } })
    ).rejects.toMatchObject({ message: expect.stringContaining('input.apiToken') })
  })

  it('treats a blank string as missing, the way the merge validator does', async () => {
    await expect(
      run({ toolId: 'zendesk_get_ticket', input: { ticketId: '4', subdomain: '', apiToken: 't' } })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('runs once every required user-only input is supplied', async () => {
    await expect(
      run({
        toolId: 'zendesk_get_ticket',
        input: { ticketId: '42', subdomain: 'acme', apiToken: 'tok' },
      })
    ).resolves.toMatchObject({ status: 'succeeded' })
  })

  /**
   * `firecrawl_scrape` declares `apiKey` required and `user-only`, and Sim
   * supplies it. Rejecting the omission would make every hosted-key tool
   * uncallable without a key the caller does not need to have.
   */
  it('does not require a key the deployment hosts', async () => {
    await expect(run({ input: { url: 'https://example.com' } })).resolves.toMatchObject({
      status: 'succeeded',
    })
  })

  /**
   * Self-hosted supplies no hosted keys — `injectHostedKeyIfNeeded` short-circuits
   * on `isHosted` — so the exemption must lift with it, or the caller is told a
   * key is optional and the provider disagrees.
   */
  it('does require that key on a deployment that hosts none', async () => {
    setEnvFlags({ isHosted: false })

    await expect(run({ input: { url: 'https://example.com' } })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('input.apiKey'),
    })
  })

  /**
   * `visibility` describes editor roles, and a direct call has no editor: the
   * caller is the only source, so an `llm-only` parameter is as much theirs to
   * send as a `user-only` one. Gating the check on `user-only` alone left
   * `thinking_tool.thought` dispatching as `undefined`.
   */
  it('refuses a missing llm-only input too — the caller is the only source here', async () => {
    await expect(run({ toolId: 'thinking_tool', input: {} })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('input.thought'),
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  it('refuses a missing user-or-llm input before dispatch rather than mid-execution', async () => {
    await expect(run({ input: {} })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('input.url'),
    })
  })

  it('accepts a {{VAR}} reference as a present value, leaving resolution to the executor', async () => {
    await run({
      toolId: 'zendesk_get_ticket',
      input: { ticketId: '4', subdomain: 'acme', apiToken: '{{ZENDESK_TOKEN}}' },
    })

    const [, params] = mocks.executeRegistryTool.mock.calls[0]
    expect(params.apiToken).toBe('{{ZENDESK_TOKEN}}')
  })

  it('requires a credential for an OAuth tool before it dispatches', async () => {
    await expect(run({ toolId: 'slack_message', input: { text: 'hi' } })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('credentialId is required'),
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  /**
   * Sixty-eight tools declare the selector as a required `user-only` parameter
   * (`oauthCredential` or `credential`) with no `oauth` block — Snowflake among
   * them. Validating required inputs against the raw body rejected a valid
   * top-level `credentialId` as a missing `oauthCredential`.
   */
  it('satisfies a declared credential selector with the top-level credentialId', async () => {
    await expect(
      run({
        toolId: 'snowflake_execute_sql',
        credentialId: 'cred-sf',
        input: { statement: 'select 1' },
      })
    ).resolves.toMatchObject({ status: 'succeeded' })

    const [, params] = mocks.executeRegistryTool.mock.calls[0]
    expect(params.oauthCredential).toBe('cred-sf')
    expect(params.credential).toBeUndefined()
  })

  it('demands credentialId for a declared required selector even without an oauth block', async () => {
    await expect(
      run({ toolId: 'snowflake_execute_sql', input: { statement: 'select 1' } })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('credentialId is required'),
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  /**
   * The alias check has to run before the declared-key check, or a tool that
   * declares `oauthCredential` lets a caller bypass the top-level field and
   * credential precedence starts differing per tool.
   */
  it('refuses input.oauthCredential even where the tool declares it', async () => {
    await expect(
      run({
        toolId: 'snowflake_execute_sql',
        input: { statement: 'select 1', oauthCredential: 'cred-sf' },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('top-level credentialId'),
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  it('passes the named credential through as the tool credential', async () => {
    await run({ toolId: 'slack_message', input: { text: 'hi' }, credentialId: 'cred-1' })

    const [, params] = mocks.executeRegistryTool.mock.calls[0]
    expect(params.credential).toBe('cred-1')
  })

  it('refuses a reserved argument rather than dropping it', async () => {
    await expect(
      run({ input: { url: 'https://a.co', _context: { userId: 'someone-else' } } })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('_context'),
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  it('refuses a hosted-key flag smuggled in as an argument', async () => {
    await expect(
      run({ input: { url: 'https://a.co', __usingHostedKey: true } })
    ).rejects.toMatchObject({
      code: 'validation',
    })
  })

  /**
   * The executor reads this straight out of params and forwards it to
   * credential-token resolution as an impersonation request. No tool declares
   * it, which is why the check is a declared-parameter allowlist rather than a
   * list of names someone remembered.
   */
  it('refuses an undeclared impersonation field', async () => {
    await expect(
      run({ input: { url: 'https://a.co', impersonateUserEmail: 'someone@example.com' } })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('impersonateUserEmail'),
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  /**
   * Declared is not accepted. `accessToken` is in the tool's params, but as
   * `hidden` — the resolved credential fills it. Letting a caller send it either
   * pre-empts the executor's value or is silently overwritten; either way the
   * published schema (which omits hidden params) made no such promise.
   */
  it('refuses a declared-but-hidden input, saying whose it is', async () => {
    await expect(
      run({
        toolId: 'slack_message',
        credentialId: 'cred-1',
        input: { text: 'hi', accessToken: 'xoxb-forged' },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('input.accessToken is supplied by Sim'),
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
  })

  it('refuses any other undeclared input, naming it', async () => {
    await expect(run({ input: { url: 'https://a.co', nope: 1 } })).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('input.nope'),
    })
  })

  it('refuses a credential named inline instead of at the top level', async () => {
    await expect(
      run({ input: { url: 'https://a.co', credential: 'cred-1' } })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('credentialId'),
    })
  })

  /**
   * The ledger de-duplicates on `eventKey`, and the derived key is a hash of
   * actor, workspace, source and description — identical for every call to the
   * same tool. Without a per-call id, `onConflictDoNothing` billed the first
   * hosted-key call and silently dropped every one after it.
   */
  it('gives each call its own ledger event so repeat calls all bill', async () => {
    mocks.executeRegistryTool.mockResolvedValue({
      success: true,
      output: { cost: { total: 0.004 } },
    })

    await run()
    await run()

    const keys = mocks.recordUsage.mock.calls.map((call) => call[0].entries[0].eventKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[0]).not.toBe(keys[1])
  })

  it('refuses a workspace API key: the call runs under a person or not at all', async () => {
    await expect(
      executeToolForCaller.execute({
        principal: workspaceKey,
        input: { workspaceId: WORKSPACE_ID, toolId: 'firecrawl_scrape', input: {} },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('reports a tool that ran and refused without failing the call', async () => {
    mocks.executeRegistryTool.mockResolvedValue({
      success: false,
      output: {},
      error: 'Firecrawl returned 402',
    })

    await expect(run()).resolves.toMatchObject({
      status: 'failed',
      error: { message: 'Firecrawl returned 402' },
    })
  })

  it('bills hosted-key spend to the workspace', async () => {
    mocks.executeRegistryTool.mockResolvedValue({
      success: true,
      output: { markdown: '# Hi', cost: { total: 0.004 } },
    })

    await run()

    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: WORKSPACE_ID,
        entries: [expect.objectContaining({ category: 'tool', source: 'api-tool', cost: 0.004 })],
      })
    )
  })

  /**
   * `output.cost` is not a hosted-key marker. `knowledge_upload_chunk` and the
   * enrichment runner report their own cost there, and the registry only writes
   * hosted-key cost when it actually injected a key. Billing on the field alone
   * charged a second time for spend already metered elsewhere.
   */
  it('does not bill a tool that reports its own cost without a hosted key', async () => {
    mocks.executeRegistryTool.mockResolvedValue({
      success: true,
      output: { chunk: 'ok', cost: { total: 0.002 } },
    })

    await run({
      toolId: 'zendesk_get_ticket',
      input: { ticketId: '4', subdomain: 'a', apiToken: 't' },
    })

    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })

  it('does not bill when the caller brought their own key', async () => {
    mocks.executeRegistryTool.mockResolvedValue({
      success: true,
      output: { cost: { total: 0.004 } },
    })

    await run({ input: { url: 'https://a.co', apiKey: 'sk-mine' } })

    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })

  it('does not bill a failed call', async () => {
    mocks.executeRegistryTool.mockResolvedValue({
      success: false,
      output: { cost: { total: 0.004 } },
      error: 'upstream refused',
    })

    await run()

    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })

  it('records nothing when the call incurred no hosted-key spend', async () => {
    await run()
    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })

  /**
   * The provider already ran and already charged Sim's key, so losing the
   * ledger row must not also lose the caller's result.
   */
  it('still answers when metering fails', async () => {
    mocks.executeRegistryTool.mockResolvedValue({
      success: true,
      output: { cost: { total: 0.004 } },
    })
    mocks.recordUsage.mockRejectedValue(new Error('ledger unavailable'))

    await expect(run()).resolves.toMatchObject({ status: 'succeeded' })
  })
})
