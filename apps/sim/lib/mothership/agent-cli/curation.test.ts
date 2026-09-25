import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mothershipBlockDetailSchema } from '@/lib/api/contracts/mothership-catalog'
import { type V2BlockDetail, v2BlockDetailSchema } from '@/lib/api/contracts/v2/catalog'
import { curateBlockDetail } from '@/lib/mothership/agent-cli/curation'
import { inputFormatValueSchema } from '@/lib/workflows/input-format-schema'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

const { permissionConfig, denied } = vi.hoisted(() => ({
  permissionConfig: { current: null as { deniedTools?: string[] } | null },
  denied: {
    current: {
      needsProjection: new Map<string, ReadonlySet<string>>(),
      fullyDenied: new Set<string>(),
    },
  },
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: vi.fn(async () => permissionConfig.current),
}))

vi.mock('@/lib/integrations/tool-projection', () => ({
  resolveDeniedBlockOperations: vi.fn(() => denied.current),
}))

const viewer = { workspaceId: 'ws', userId: 'user' }

const queryAvailability = vi.hoisted(() =>
  vi.fn(async () => ({ enabled: false, reason: 'Not enabled' }))
)
vi.mock('@/lib/table/query-availability', () => ({ getTableQueryAvailability: queryAvailability }))
const workspaceContext = vi.hoisted(() => vi.fn())
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: workspaceContext,
}))

function blockDetail(): V2BlockDetail {
  return {
    id: 'slack',
    name: 'Slack',
    description: 'Messaging',
    category: 'tools',
    source: 'builtin',
    triggerAllowed: false,
    triggerCapable: false,
    triggerIds: [],
    triggers: [],
    tags: [],
    preview: false,
    operationIds: ['send', 'canvas'],
    toolIds: ['slack_send', 'slack_canvas'],
    inputSchema: [
      { id: 'operation', type: 'dropdown', options: [{ id: 'send' }, { id: 'canvas' }] },
    ],
    operationInputSchema: { send: [], canvas: [] },
    inputDefinitions: {},
    outputs: {},
    operations: {
      send: { toolId: 'slack_send', inputs: {}, outputs: {}, inputSchema: [] },
      canvas: { toolId: 'slack_canvas', inputs: {}, outputs: {}, inputSchema: [] },
    },
    tools: ['slack_send', 'slack_canvas'].map((id) => ({
      id,
      name: id,
      description: '',
      hostedApiKey: 'none',
      params: {},
      outputs: {},
    })),
  }
}

function ok(stdout: string) {
  return { exitCode: 0, stdout, stderr: '' }
}

describe('curateBlockDetail', () => {
  beforeEach(() => {
    queryAvailability.mockClear()
    workspaceContext
      .mockReset()
      .mockResolvedValue({ workspaceId: 'ws', workspaceOrganizationId: 'canonical-target-org' })
    permissionConfig.current = null
    denied.current = { needsProjection: new Map(), fullyDenied: new Set() }
  })

  it.each(['agent', 'mothership'])(
    'publishes the %s attachment contract on demand only',
    async (id) => {
      const original = { ...blockDetail(), id, inputSchema: [{ id: 'tools', type: 'tool-input' }] }
      const result = await curateBlockDetail(ok(JSON.stringify(original)), viewer)
      const detail = mothershipBlockDetailSchema.parse(JSON.parse(result.stdout))
      const field = detail.inputSchema[0]
      expect(field?.valueSchema).toMatchObject({
        type: 'array',
        items: { anyOf: expect.any(Array) },
      })
      expect(JSON.stringify(field?.valueSchema)).toContain('usageControlExpression')
      expect(JSON.stringify(field?.valueSchema)).toContain('force')
      expect(field?.toolBinding?.selectionMode).toBe(id === 'agent' ? 'explicit' : 'additive')
      expect(field?.toolBinding?.naming).toContain(
        id === 'agent' ? 'operations[operation].toolId' : 'call_integration_tool'
      )
      expect(v2BlockDetailSchema.parse(detail).inputSchema[0]).not.toHaveProperty('toolBinding')
      expect(v2BlockDetailSchema.parse(detail).inputSchema[0]).not.toHaveProperty('valueSchema')
      expect(original.inputSchema[0]).not.toHaveProperty('valueSchema')
    }
  )

  it.each(['start_trigger', 'api_trigger', 'input_trigger', 'human_in_the_loop'])(
    'publishes the input editor value contract for %s without changing v2',
    async (id) => {
      const original = {
        ...blockDetail(),
        id,
        inputSchema: [{ id: 'inputFormat', type: 'input-format' }],
      }
      const result = await curateBlockDetail(ok(JSON.stringify(original)), viewer)
      const detail = mothershipBlockDetailSchema.parse(JSON.parse(result.stdout))
      const schema = detail.inputSchema[0]?.valueSchema
      expect(schema).toMatchObject({
        type: 'array',
        items: {
          required: ['name', 'type'],
          properties: {
            type: { enum: ['string', 'number', 'boolean', 'object', 'array', 'file[]'] },
          },
        },
      })
      expect(v2BlockDetailSchema.parse(detail).inputSchema[0]).not.toHaveProperty('valueSchema')
      if (id === 'start_trigger')
        expect(Object.keys(detail.outputs)).toEqual(['input', 'conversationId', 'files'])
      expect(
        inputFormatValueSchema.parse([{ name: 'documents', type: 'file[]', value: '[]' }])
      ).toEqual([{ name: 'documents', type: 'file[]', value: '[]' }])
    }
  )

  it('projects rollout eligibility only for permitted operations using the target organization', async () => {
    const original = { ...blockDetail(), toolIds: ['table_query_rows_v2'] }
    const staleChatContext = { ...viewer, organizationId: 'unrelated-chat-org' }
    const result = await curateBlockDetail(ok(JSON.stringify(original)), staleChatContext)
    expect(JSON.parse(result.stdout).operationAvailability).toEqual({
      table_query_rows_v2: { enabled: false, reason: 'Not enabled' },
    })
    expect(queryAvailability).toHaveBeenLastCalledWith({
      userId: 'user',
      orgId: 'canonical-target-org',
    })
    expect(workspaceContext).toHaveBeenCalledWith('ws')
    workspaceContext.mockClear()
    queryAvailability.mockClear()
    const legacy = await curateBlockDetail(
      ok(JSON.stringify({ ...original, toolIds: ['table_query_rows'] })),
      viewer
    )
    expect(JSON.parse(legacy.stdout)).not.toHaveProperty('operationAvailability')
    expect(queryAvailability).not.toHaveBeenCalled()
    expect(workspaceContext).not.toHaveBeenCalled()
  })

  it('uses the canonical organization when the workspace viewer has no organization context', async () => {
    await curateBlockDetail(
      ok(JSON.stringify({ ...blockDetail(), toolIds: ['table_query_rows_v2'] })),
      viewer
    )
    expect(queryAvailability).toHaveBeenCalledWith({
      userId: 'user',
      orgId: 'canonical-target-org',
    })
  })

  it('does not evaluate rollout for a denied typed query operation', async () => {
    permissionConfig.current = { deniedTools: ['table_query_rows_v2'] }
    denied.current = {
      fullyDenied: new Set(),
      needsProjection: new Map([['slack', new Set(['query'])]]),
    }
    const original = { ...blockDetail(), toolIds: ['table_query_rows_v2', 'slack_send'] }
    const result = await curateBlockDetail(ok(JSON.stringify(original)), viewer)
    expect(JSON.parse(result.stdout)).not.toHaveProperty('operationAvailability')
    expect(workspaceContext).not.toHaveBeenCalled()
    expect(queryAvailability).not.toHaveBeenCalled()
  })

  it('drops denied operations and their tools from a partially denied block', async () => {
    permissionConfig.current = { deniedTools: ['slack_canvas'] }
    denied.current = {
      needsProjection: new Map([['slack', new Set(['canvas'])]]),
      fullyDenied: new Set(),
    }
    const result = await curateBlockDetail(ok(JSON.stringify(blockDetail())), viewer)
    expect(result.exitCode).toBe(0)
    const curated = JSON.parse(result.stdout)
    expect(Object.keys(curated.operations)).toEqual(['send'])
    expect(curated.tools.map((tool: { id: string }) => tool.id)).toEqual(['slack_send'])
    expect(curated.operationIds).toEqual(['send'])
    expect(curated.operationInputSchema).toEqual({ send: [] })
    expect(curated.inputSchema[0].options).toEqual([{ id: 'send' }])
    expect(curated.toolIds).toEqual(['slack_send'])
  })

  it('adds canonical model hints only on the internal curated response', async () => {
    const models = Object.values(PROVIDER_DEFINITIONS)
      .flatMap((provider) => provider.models)
      .filter((model) => model.sunset?.status !== 'deprecated')
    const original = {
      ...blockDetail(),
      inputSchema: [
        {
          id: 'model',
          type: 'combobox',
          options: [...models.map((model) => ({ id: model.id })), { id: 'private-local-model' }],
        },
      ],
    }
    const publicShape = v2BlockDetailSchema.parse(original)
    expect(publicShape).toEqual(original)
    const result = await curateBlockDetail(ok(JSON.stringify(original)), viewer)
    const detail = mothershipBlockDetailSchema.parse(JSON.parse(result.stdout))
    const field = detail.inputSchema[0]!
    expect(field.optionsAvailability).toContain(
      'deployment, provider credentials and model permissions'
    )
    expect(field.options).toHaveLength(original.inputSchema[0]!.options.length)
    for (const model of models) {
      const option = field.options!.find((option) => option.id === model.id)!
      expect(option.recommended).toBe(model.recommended || undefined)
      expect(option.speedOptimized).toBe(model.speedOptimized || undefined)
      expect(option.sunset).toEqual(model.sunset)
      expect(option).not.toHaveProperty('runnable')
      expect(option).not.toHaveProperty('pricing')
    }
    expect(field.options!.at(-1)).toEqual({ id: 'private-local-model' })
    expect(v2BlockDetailSchema.parse(detail)).toEqual(original)
  })

  it('applies denied operation projection before adding model hints', async () => {
    permissionConfig.current = { deniedTools: ['slack_canvas'] }
    denied.current.needsProjection.set('slack', new Set(['canvas']))
    const original = blockDetail()
    original.inputSchema.push({
      id: 'model',
      type: 'combobox',
      options: [{ id: 'claude-sonnet-5' }],
    })
    const result = await curateBlockDetail(ok(JSON.stringify(original)), viewer)
    const detail = mothershipBlockDetailSchema.parse(JSON.parse(result.stdout))
    expect(Object.keys(detail.operations)).toEqual(['send'])
    expect(detail.inputSchema[0]!.options).toEqual([{ id: 'send' }])
    expect(detail.inputSchema[1]!.optionsAvailability).toBeDefined()
    denied.current.fullyDenied.add('slack')
    const blocked = await curateBlockDetail(ok(JSON.stringify(original)), viewer)
    expect(blocked.exitCode).toBe(1)
    expect(blocked.stdout).not.toContain('recommended')
  })

  it('refuses a fully denied block', async () => {
    permissionConfig.current = { deniedTools: ['slack_send', 'slack_canvas'] }
    denied.current = { needsProjection: new Map(), fullyDenied: new Set(['slack']) }
    const result = await curateBlockDetail(ok(JSON.stringify(blockDetail())), viewer)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('not available to you')
  })
})
