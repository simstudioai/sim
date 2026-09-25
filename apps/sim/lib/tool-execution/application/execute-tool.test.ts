import type {
  PersonalApiKeyPrincipal,
  SessionPrincipal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
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
  executeFileManage: vi.fn(),
  resolveBillingAttribution: vi.fn(),
  checkExecutionUsageLimits: vi.fn(),
  recordUsage: vi.fn(),
}))

vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  loadActiveWorkspaceApplicationContext: mocks.loadWorkspace,
  resolveActiveWorkspaceApplicationContext: mocks.loadWorkspace,
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

vi.mock('@/lib/internal/file/operations', () => ({
  executeFileManageOperation: mocks.executeFileManage,
  getFileContentProvenance: vi.fn(),
  fileContentJsonResponse: vi.fn(),
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mocks.resolveBillingAttribution,
  toBillingContext: () => ({
    billingEntity: { type: 'workspace', id: WORKSPACE_ID },
    billingPeriod: { start: new Date('2026-01-01'), end: new Date('2026-02-01') },
  }),
}))

vi.mock('@/lib/billing/core/usage-log', () => ({ recordUsage: mocks.recordUsage }))
vi.mock('@/lib/billing/core/usage-gate-cache', () => ({
  checkExecutionUsageLimits: mocks.checkExecutionUsageLimits,
}))

import { executeFileTool } from '@/lib/internal/file/execute-tool'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { executeToolForCaller } from '@/lib/tool-execution/application/execute-tool'
import type { BlockConfig } from '@/blocks/types'
import { fileMoveTool } from '@/tools/file/folders'
import { fileReadTool } from '@/tools/file/get'
import { functionExecuteTool } from '@/tools/function/execute'

const TOOL_METADATA: Record<string, Record<string, unknown>> = {
  function_execute: { ...functionExecuteTool },
  file_read: { ...fileReadTool },
  file_move: { ...fileMoveTool },
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

const fileBlock = block({ type: 'file_v5', tools: { access: ['file_read', 'file_move'] } })
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
    // Hosted-key injection only happens where Sim hosts keys.
    setEnvFlags({ isHosted: true })
    mocks.loadWorkspace.mockResolvedValue(workspaceContext)
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.allowedIntegrationTypes.mockResolvedValue(null)
    mocks.getBlockVisibility.mockResolvedValue({ revealed: new Set(), disabled: new Set() })
    mocks.listCustomBlocks.mockResolvedValue([])
    mocks.isDeploymentAvailable.mockReturnValue(true)
    mocks.getAllBlocks.mockReturnValue([
      fileBlock,
      block({ type: 'function', tools: { access: ['function_execute'] } }),
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
    mocks.checkExecutionUsageLimits.mockResolvedValue({ isExceeded: false })
  })

  it.each<PersonalApiKeyPrincipal | SessionPrincipal>([
    principal,
    { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
  ])('hands the authenticated $kind caller through to the real File handler', async (caller) => {
    mocks.executeFileManage.mockResolvedValue(
      Response.json({ success: true, data: { files: [{ id: 'file-1' }] } })
    )
    /** Adapt the existing registry mock at its dispatch boundary; admission and File handling are real. */
    mocks.executeRegistryTool.mockImplementationOnce(
      async (
        toolId: string,
        params: Parameters<typeof fileReadTool.operation.input>[0],
        options: { operationContext: InternalToolOperationContext }
      ) => {
        const response = await executeFileTool({
          toolId,
          input: fileReadTool.operation.input(params),
          context: options.operationContext,
          headers: new Headers(),
          requestId: 'direct-file-read',
        })
        return fileReadTool.transformResponse?.(response)
      }
    )

    const result = await executeToolForCaller.execute({
      principal: caller,
      input: { workspaceId: WORKSPACE_ID, toolId: 'file_read', input: { fileId: 'file-1' } },
    })

    expect(result).toMatchObject({ status: 'succeeded', output: { files: [{ id: 'file-1' }] } })
    const [, params, options] = mocks.executeRegistryTool.mock.calls[0]
    expect(options.operationContext.callerPrincipal).toBe(caller)
    expect(options.operationContext.workflowId).toBe('')
    expect(options.operationContext.executorDelegationOrigin).toBeUndefined()
    expect(params).not.toHaveProperty('callerPrincipal')
    expect(params._context).not.toHaveProperty('callerPrincipal')
    expect(mocks.executeFileManage.mock.calls[0]?.[1].principal).toBe(caller)
  })

  it('refuses direct Function execution before dispatch when usage admission denies it', async () => {
    mocks.checkExecutionUsageLimits.mockResolvedValueOnce({
      isExceeded: true,
      scope: 'payer',
      message: 'Organization usage limit exceeded',
    })
    await expect(
      run({ toolId: 'function_execute', input: { code: 'return 1' } })
    ).rejects.toMatchObject({
      name: 'ToolExecutionUsageLimitError',
      message: 'Organization usage limit exceeded',
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })

  it('fails closed without provider dispatch or metering when Function usage admission is unavailable', async () => {
    mocks.checkExecutionUsageLimits.mockRejectedValueOnce(new Error('ledger unavailable'))
    await expect(run({ toolId: 'function_execute', input: { code: 'return 1' } })).rejects.toThrow(
      'ledger unavailable'
    )
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
    expect(mocks.recordUsage).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'meters actual direct Function sandbox cost when success=%s',
    async (success) => {
      mocks.executeRegistryTool.mockResolvedValueOnce({
        success,
        output: { result: null, cost: { input: 0, output: 0, total: 0.25 } },
        ...(success ? {} : { error: 'Code failed' }),
      })
      await executeToolForCaller.execute({
        principal,
        input: {
          workspaceId: WORKSPACE_ID,
          toolId: 'function_execute',
          input: { code: 'return 1' },
        },
      })
      expect(mocks.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          workspaceId: WORKSPACE_ID,
          entries: [
            expect.objectContaining({
              cost: 0.25,
              source: 'api-tool',
              description: 'Tool call: function_execute',
            }),
          ],
        })
      )
    }
  )

  it('dispatches file_move with the authenticated principal and preserves its destination', async () => {
    mocks.executeFileManage.mockResolvedValue(
      Response.json({
        success: true,
        data: { fileId: 'file-1', folderPath: '/Generated' },
      })
    )
    mocks.executeRegistryTool.mockImplementationOnce(
      async (
        toolId: string,
        params: Parameters<typeof fileMoveTool.operation.input>[0],
        options: { operationContext: InternalToolOperationContext }
      ) =>
        fileMoveTool.transformResponse?.(
          await executeFileTool({
            toolId,
            input: fileMoveTool.operation.input(params),
            context: options.operationContext,
            headers: new Headers(),
            requestId: 'direct-file-move',
          })
        )
    )

    const result = await run({
      toolId: 'file_move',
      input: { fileId: 'file-1', folderPath: '/Generated' },
    })
    expect(result).toMatchObject({
      status: 'succeeded',
      output: { fileId: 'file-1', folderPath: '/Generated' },
    })
    expect(mocks.executeFileManage).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'move',
        fileId: 'file-1',
        folderPath: '/Generated',
      }),
      expect.objectContaining({ principal, workspaceId: WORKSPACE_ID })
    )
  })

  it.each([
    'callerPrincipal',
    'principal',
    'operationContext',
    'executorDelegationOrigin',
    'meterSandboxUsage',
    '_context',
  ])('rejects caller input attempting to supply %s authority', async (key) => {
    await expect(
      run({ input: { url: 'https://a.co', [key]: { callerPrincipal: principal } } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
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

  it('conceals a tool no visible block exposes as absent', async () => {
    await expect(run({ toolId: 'preview_call' })).rejects.toMatchObject({
      code: 'not_found',
      message: 'Tool not found',
    })
    expect(mocks.executeRegistryTool).not.toHaveBeenCalled()
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

  it('requires a credential for an OAuth tool before it dispatches', async () => {
    await expect(run({ toolId: 'slack_message', input: { text: 'hi' } })).rejects.toMatchObject({
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

  /**
   * The BYOK shape. The registry injected the org's own key and returned
   * `isUsingHostedKey: false`, so it wrote no `output.cost` — and the caller
   * omitted the key, which a pre-dispatch derivation reads as "Sim's". Only the
   * registry's verdict, carried by the presence of the cost it alone writes,
   * gets this right.
   */
  it('does not bill a BYOK call, where the key was omitted but Sim did not pay', async () => {
    mocks.executeRegistryTool.mockResolvedValue({
      success: true,
      output: { markdown: '# Hi' },
    })

    await run({ input: { url: 'https://a.co' } })

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
