/**
 * Differential parity between the editing engine and the source apply gates.
 *
 * Each case states one change twice: as the edit operations the engine is sent today, and as the
 * base → target graph pair source apply sees. The engine's refusals (skipped items, dropped
 * inputs, enablement refusals, the sandbox plan check) and the source gates' diagnostics are both
 * reduced to `category:blockId` and must be equal. The refusing fixtures mirror
 * `editing/operations.test.ts`, `application/apply-workflow-operations.test.ts` and
 * `editing/validation.test.ts`; the locked and trigger cases cover engine rules those files
 * reach only through mocks.
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  billingSubscriptionMock,
  billingSubscriptionMockFns,
} from '@sim/testing/mocks/billing-subscription.mock'
import { integrationsAvailabilityMock } from '@sim/testing/mocks/integrations-availability.mock'
import type { BlockState } from '@sim/workflow-types/workflow'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PERMISSION_GROUP_CONFIG,
  type PermissionGroupConfig,
} from '@/lib/permission-groups/fields'
import { gateSourceDiff, SKIP_TYPE_APPLY_CODES } from '@/lib/workflows/code/apply/gates'
import { diffGraphs, type SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import { findLockedBlockRefusals } from '@/lib/workflows/code/apply/locked'
import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { decideBlockEnablement } from '@/lib/workflows/editing/block-enablement'
import { applyOperationsToWorkflowState } from '@/lib/workflows/editing/engine'
import { BLOCK_GATES } from '@/lib/workflows/editing/gates'
import { operationsReferenceSimSandbox } from '@/lib/workflows/editing/sandbox-projection'
import type { EditWorkflowOperation } from '@/lib/workflows/editing/types'
import { isDeferredSkippedItem } from '@/lib/workflows/editing/types'
import { preValidateCredentialInputs } from '@/lib/workflows/editing/validation'
import { getAllBlocks, getBlock } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import * as providerModels from '@/providers/models'

vi.mock('@/lib/integrations/availability.server', () => integrationsAvailabilityMock)
vi.mock('@/lib/billing/core/subscription', () => billingSubscriptionMock)
const { mockValidateSelectorIds } = vi.hoisted(() => ({ mockValidateSelectorIds: vi.fn() }))
vi.mock('@/lib/workflows/editing/selector-validator', () => ({
  validateSelectorIds: mockValidateSelectorIds,
}))

const MOCK_REGISTRY_BLOCKS: Record<string, unknown> = {
  agent: {
    type: 'agent',
    name: 'Agent',
    subBlocks: [
      { id: 'systemPrompt', type: 'long-input' },
      { id: 'model', type: 'combobox' },
      { id: 'apiKey', type: 'short-input' },
      { id: 'tools', type: 'tool-input' },
    ],
  },
  mothership: {
    type: 'mothership',
    name: 'Sim Chat',
    subBlocks: [{ id: 'tools', type: 'tool-input' }],
  },
  function: {
    type: 'function',
    name: 'Function',
    subBlocks: [
      { id: 'code', type: 'code' },
      { id: 'sandboxId', type: 'short-input' },
    ],
  },
  slack: {
    type: 'slack',
    name: 'Slack',
    tools: {
      access: ['slack_message', 'slack_canvas'],
      config: {
        tool: ({ operation }: { operation?: string }) =>
          operation === 'canvas' ? 'slack_canvas' : 'slack_message',
      },
    },
    subBlocks: [
      {
        id: 'operation',
        type: 'dropdown',
        options: [
          { label: 'Send Message', id: 'send' },
          { label: 'Create Canvas', id: 'canvas' },
        ],
      },
      { id: 'channel', type: 'short-input' },
      { id: 'triggerConfig', type: 'trigger-config' },
    ],
  },
  slack_v2: {
    type: 'slack_v2',
    name: 'Slack',
    tools: {
      access: ['slack_v2_message', 'slack_v2_canvas'],
      config: {
        tool: ({ operation }: { operation?: string }) =>
          operation === 'canvas' ? 'slack_v2_canvas' : 'slack_v2_message',
      },
    },
    subBlocks: [
      {
        id: 'operation',
        type: 'dropdown',
        options: [
          { label: 'Send Message', id: 'send' },
          { label: 'Create Canvas', id: 'canvas' },
        ],
      },
    ],
  },
  human_in_the_loop: {
    type: 'human_in_the_loop',
    name: 'Human in the Loop',
    subBlocks: [{ id: 'notification', type: 'tool-input' }],
  },
  jira_v2: {
    type: 'jira_v2',
    name: 'Jira',
    tools: { access: ['jira_v2_get_issue'] },
    subBlocks: [{ id: 'credential', type: 'oauth-input' }],
  },
  jira: {
    type: 'jira',
    name: 'Jira',
    tools: { access: ['jira_get_issue'] },
    subBlocks: [{ id: 'credential', type: 'oauth-input' }],
  },
  table: {
    type: 'table',
    name: 'Table (Legacy)',
    sunset: { status: 'legacy', replacedBy: 'table_v2' },
    subBlocks: [{ id: 'tableId', type: 'short-input' }],
  },
  table_v2: {
    type: 'table_v2',
    name: 'Table',
    subBlocks: [{ id: 'tableId', type: 'short-input' }],
  },
  api_trigger: { type: 'api_trigger', name: 'API', subBlocks: [] },
  start_trigger: { type: 'start_trigger', name: 'Start', subBlocks: [] },
  starter: { type: 'starter', name: 'Starter', subBlocks: [] },
  response: { type: 'response', name: 'Response', singleInstance: true, subBlocks: [] },
}
;(getAllBlocks as Mock).mockImplementation(() => Object.values(MOCK_REGISTRY_BLOCKS))
;(getBlock as Mock).mockImplementation((type: string) => MOCK_REGISTRY_BLOCKS[type])

const CTX = { userId: 'user-1', workspaceId: 'workspace-1' }
/** No type is kept-but-not-addable, and findings carry no source key. */
const SOURCE_SCOPE = {
  catalog: buildBlockCatalog({ blocks: [], trigger: () => undefined, sdkNames: SDK_NAMES }),
  keyOf: () => undefined,
}

const ID = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
  d: '44444444-4444-4444-8444-444444444444',
  loop: '55555555-5555-4555-8555-555555555555',
}

interface BlockOptions {
  sub?: Record<string, unknown>
  parentId?: string
  locked?: boolean
  enabled?: boolean
  retry?: BlockState['retry']
}

function block(id: string, type: string, name: string, options: BlockOptions = {}): BlockState {
  const config = MOCK_REGISTRY_BLOCKS[type] as { subBlocks?: { id: string; type: string }[] }
  const subBlocks: BlockState['subBlocks'] = {}
  for (const [key, value] of Object.entries(options.sub ?? {})) {
    const type = config?.subBlocks?.find((sb) => sb.id === key)?.type ?? 'short-input'
    subBlocks[key] = { id: key, type, value } as BlockState['subBlocks'][string]
  }
  return {
    id,
    type,
    name,
    position: { x: 0, y: 0 },
    subBlocks,
    outputs: {},
    enabled: options.enabled ?? true,
    ...(options.locked ? { locked: true } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
    data: options.parentId ? { parentId: options.parentId, extent: 'parent' } : {},
  }
}

const RETRY = { enabled: true, maxTries: 3, waitBetweenTriesMs: 1000 }

function graph(...blocks: BlockState[]): SourceGraph {
  return { blocks: Object.fromEntries(blocks.map((b) => [b.id, b])), edges: [] }
}

/** Replaces or adds blocks by id; `null` removes one. */
function edit(base: SourceGraph, changes: Record<string, BlockState | null>): SourceGraph {
  const blocks = { ...structuredClone(base.blocks) }
  for (const [id, next] of Object.entries(changes)) {
    if (next) blocks[id] = next
    else delete blocks[id]
  }
  return { blocks, edges: structuredClone(base.edges) }
}

interface ParityCase {
  name: string
  base: SourceGraph
  /** What the engine is sent today. */
  operations?: EditWorkflowOperation[]
  enabledChanges?: { blockId: string; enabled: boolean }[]
  /** The same change as source apply sees it. */
  target: SourceGraph
  permissionConfig?: PermissionGroupConfig | null
  isCopilot?: boolean
  /** The refusals both sides must report; `[]` asserts both accept. */
  expected: string[]
}

const ENABLEMENT_CATEGORY = {
  not_found: 'block_not_found',
  locked: 'block_locked',
  disabled_ancestor: 'disabled_ancestor',
} as const

function isCredentialField(blockType: string, field: string): boolean {
  const config = MOCK_REGISTRY_BLOCKS[blockType] as { subBlocks: { id: string; type: string }[] }
  return config?.subBlocks.some((sb) => sb.id === field && sb.type === 'oauth-input') ?? false
}

function toolInputField(blockType: string, field: string): boolean {
  const config = MOCK_REGISTRY_BLOCKS[blockType] as { subBlocks: { id: string; type: string }[] }
  return config?.subBlocks.some((sb) => sb.id === field && sb.type === 'tool-input') ?? false
}

async function engineRefusals(testCase: ParityCase): Promise<string[]> {
  const operations = testCase.operations ?? []
  const base = structuredClone(testCase.base) as unknown as Record<string, unknown>
  const refusals = new Set<string>()

  if (
    operationsReferenceSimSandbox(operations) &&
    !(await billingSubscriptionMockFns.mockHasWorkspaceSandboxAccess(CTX.workspaceId))
  ) {
    for (const op of operations) {
      if (op.params?.inputs && 'sandboxId' in op.params.inputs)
        refusals.add(`sandbox_plan:${op.block_id}`)
    }
  }

  const pre = await preValidateCredentialInputs(operations, CTX, base)
  for (const error of pre.errors) {
    refusals.add(
      `${isCredentialField(error.blockType, error.field) ? 'credential' : 'hosted_key'}:${error.blockId}`
    )
  }
  const result = applyOperationsToWorkflowState(
    base,
    pre.filteredOperations,
    testCase.permissionConfig ?? null,
    testCase.isCopilot ?? false
  )
  for (const item of result.skippedItems) {
    if (!isDeferredSkippedItem(item)) refusals.add(`${item.type}:${item.blockId}`)
  }
  for (const error of result.validationErrors) {
    if (testCase.isCopilot && toolInputField(error.blockType, error.field)) {
      refusals.add(`invalid_subblock_field:${error.blockId}`)
    }
  }
  for (const change of testCase.enabledChanges ?? []) {
    const decision = decideBlockEnablement(result.state.blocks, change.blockId, change.enabled)
    if (decision.outcome === 'refused') {
      refusals.add(`${ENABLEMENT_CATEGORY[decision.refusal.reason]}:${change.blockId}`)
    }
  }
  return [...refusals].sort()
}

const APPLY_CODE_CATEGORY: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SKIP_TYPE_APPLY_CODES).map(([skip, code]) => [code, skip])),
  E_APPLY_LOCKED_BLOCK: 'block_locked',
  E_APPLY_CREDENTIAL_UNREACHABLE: 'credential',
  W_APPLY_HOSTED_KEY_DROPPED: 'hosted_key',
  E_APPLY_SANDBOX_PLAN_REQUIRED: 'sandbox_plan',
}

async function sourceRefusals(testCase: ParityCase): Promise<string[]> {
  const diff = diffGraphs(testCase.base, testCase.target)
  const diagnostics = [
    ...findLockedBlockRefusals(testCase.base, testCase.target, diff, SOURCE_SCOPE.keyOf),
    ...(await gateSourceDiff({
      ...SOURCE_SCOPE,
      base: testCase.base,
      target: testCase.target,
      diff,
      permissionConfig: testCase.permissionConfig ?? null,
      subjectUserId: CTX.userId,
      workspaceId: CTX.workspaceId,
      isCopilot: testCase.isCopilot ?? false,
    })),
  ]
  const refusals = new Set<string>()
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === 'W_APPLY_TYPE_CHANGED') continue
    const category = APPLY_CODE_CATEGORY[diagnostic.code]
    expect(category, `unmapped code ${diagnostic.code}`).toBeDefined()
    refusals.add(`${category}:${diagnostic.blockId}`)
  }
  return [...refusals].sort()
}

const denyCanvas = { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedTools: ['slack_canvas'] }

const lockedLoopBase = graph(
  block(ID.loop, 'loop', 'Each', { locked: true }),
  block(ID.a, 'agent', 'Inner', { parentId: ID.loop, sub: { systemPrompt: 'old' } }),
  block(ID.b, 'agent', 'Outside', { sub: { systemPrompt: 'old' } })
)

const CASES: ParityCase[] = [
  // editing/operations.test.ts › sunset block types
  {
    name: 'sunset: refuses a new legacy child merged into a container, keeps the placed one editable',
    base: graph(
      block(ID.loop, 'loop', 'Each'),
      block(ID.a, 'table', 'Rows', { parentId: ID.loop, sub: { tableId: 'tbl_old' } })
    ),
    operations: [
      {
        operation_type: 'edit',
        block_id: ID.loop,
        params: {
          nestedNodes: {
            [ID.a]: { type: 'table', name: 'Rows', inputs: { tableId: 'tbl_new' } },
            [ID.b]: { type: 'table', name: 'Fresh rows' },
          },
        },
      },
    ],
    target: graph(
      block(ID.loop, 'loop', 'Each'),
      block(ID.a, 'table', 'Rows', { parentId: ID.loop, sub: { tableId: 'tbl_new' } }),
      block(ID.b, 'table', 'Fresh rows', { parentId: ID.loop })
    ),
    expected: [`block_not_allowed:${ID.b}`],
  },
  {
    name: 'sunset: refuses a new legacy block top-level, nested and inserted',
    base: graph(),
    operations: [
      { operation_type: 'add', block_id: ID.a, params: { type: 'table', name: 'Rows' } },
      {
        operation_type: 'add',
        block_id: ID.loop,
        params: {
          type: 'loop',
          name: 'Each',
          nestedNodes: { [ID.b]: { type: 'table', name: 'Nested rows' } },
        },
      },
      {
        operation_type: 'insert_into_subflow',
        block_id: ID.c,
        params: { type: 'table', name: 'Inserted rows', subflowId: ID.loop },
      },
    ],
    target: graph(
      block(ID.a, 'table', 'Rows'),
      block(ID.loop, 'loop', 'Each'),
      block(ID.b, 'table', 'Nested rows', { parentId: ID.loop }),
      block(ID.c, 'table', 'Inserted rows', { parentId: ID.loop })
    ),
    expected: [
      `block_not_allowed:${ID.a}`,
      `block_not_allowed:${ID.b}`,
      `block_not_allowed:${ID.c}`,
    ],
  },
  {
    name: 'sunset: keeps a legacy block editable but refuses switching another block to it',
    base: graph(
      block(ID.a, 'table', 'Rows', { sub: { tableId: 'tbl_old' } }),
      block(ID.b, 'table_v2', 'V2', { sub: { tableId: 'tbl_old' } })
    ),
    operations: [
      { operation_type: 'edit', block_id: ID.a, params: { inputs: { tableId: 'tbl_new' } } },
      { operation_type: 'edit', block_id: ID.b, params: { type: 'table' } },
    ],
    target: graph(
      block(ID.a, 'table', 'Rows', { sub: { tableId: 'tbl_new' } }),
      block(ID.b, 'table', 'V2', { sub: { tableId: 'tbl_old' } })
    ),
    expected: [`block_not_allowed:${ID.b}`],
  },
  // editing/operations.test.ts › permission-group tool access
  {
    name: 'tools: refuses an added block whose operation the group denies',
    base: graph(),
    operations: [
      {
        operation_type: 'add',
        block_id: ID.a,
        params: { type: 'slack', name: 'Slack 1', inputs: { operation: 'canvas', channel: '#g' } },
      },
    ],
    target: graph(block(ID.a, 'slack', 'Slack 1', { sub: { operation: 'canvas', channel: '#g' } })),
    permissionConfig: denyCanvas,
    expected: [`tool_not_allowed:${ID.a}`],
  },
  {
    name: 'tools: refuses an edit to a denied operation',
    base: graph(block(ID.a, 'slack', 'Slack 1', { sub: { operation: 'send' } })),
    operations: [
      { operation_type: 'edit', block_id: ID.a, params: { inputs: { operation: 'canvas' } } },
    ],
    target: graph(block(ID.a, 'slack', 'Slack 1', { sub: { operation: 'canvas' } })),
    permissionConfig: denyCanvas,
    expected: [`tool_not_allowed:${ID.a}`],
  },
  {
    name: 'models: refuses a model the group denies',
    base: graph(),
    operations: [
      {
        operation_type: 'add',
        block_id: ID.a,
        params: { type: 'agent', name: 'Agent 1', inputs: { model: 'gpt-4o', systemPrompt: 'hi' } },
      },
    ],
    target: graph(
      block(ID.a, 'agent', 'Agent 1', { sub: { model: 'gpt-4o', systemPrompt: 'hi' } })
    ),
    permissionConfig: { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedModels: ['GPT-4o'] },
    expected: [`model_not_allowed:${ID.a}`],
  },
  {
    name: 'tools: gates the trigger-config fan-out onto a denied operation',
    base: graph(
      block(ID.a, 'slack', 'Slack 1', {
        sub: {
          operation: 'send',
          channel: '#general',
          triggerConfig: { operation: 'canvas', channel: '#random' },
        },
      })
    ),
    operations: [
      { operation_type: 'edit', block_id: ID.a, params: { inputs: { triggerConfig: {} } } },
    ],
    target: graph(
      block(ID.a, 'slack', 'Slack 1', {
        sub: {
          operation: 'canvas',
          channel: '#random',
          triggerConfig: { operation: 'canvas', channel: '#random' },
        },
      })
    ),
    permissionConfig: denyCanvas,
    expected: [`tool_not_allowed:${ID.a}`],
  },
  {
    name: 'tools: refuses an agent tool entry whose operation the group denies',
    base: graph(),
    operations: [
      {
        operation_type: 'add',
        block_id: ID.a,
        params: {
          type: 'agent',
          name: 'Agent 1',
          inputs: {
            tools: [
              { type: 'slack', operation: 'canvas', title: 'Create Canvas' },
              { type: 'slack', operation: 'send', title: 'Send Message' },
            ],
          },
        },
      },
    ],
    target: graph(
      block(ID.a, 'agent', 'Agent 1', {
        sub: {
          tools: [
            { type: 'slack', operation: 'canvas', title: 'Create Canvas' },
            { type: 'slack', operation: 'send', title: 'Send Message' },
          ],
        },
      })
    ),
    permissionConfig: denyCanvas,
    expected: [`tool_not_allowed:${ID.a}`],
  },
  {
    name: 'tools: a denied tool already stored is not refused when the edit leaves it alone',
    base: graph(
      block(ID.a, 'agent', 'Agent 1', {
        sub: { tools: [{ type: 'slack', operation: 'canvas', title: 'Old' }] },
      })
    ),
    operations: [
      { operation_type: 'edit', block_id: ID.a, params: { inputs: { systemPrompt: 'new' } } },
    ],
    target: graph(
      block(ID.a, 'agent', 'Agent 1', {
        sub: { tools: [{ type: 'slack', operation: 'canvas', title: 'Old' }], systemPrompt: 'new' },
      })
    ),
    permissionConfig: denyCanvas,
    expected: [],
  },
  // block-type gates
  {
    name: 'allowlist: refuses a block type outside the group integration allowlist',
    base: graph(),
    operations: [{ operation_type: 'add', block_id: ID.a, params: { type: 'slack', name: 'S' } }],
    target: graph(block(ID.a, 'slack', 'S')),
    permissionConfig: { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations: ['agent'] },
    expected: [`block_not_allowed:${ID.a}`],
  },
  {
    name: 'registry: refuses an unknown block type',
    base: graph(),
    operations: [
      { operation_type: 'add', block_id: ID.a, params: { type: 'not_a_block', name: 'X' } },
    ],
    target: graph(block(ID.a, 'not_a_block', 'X')),
    expected: [`invalid_block_type:${ID.a}`],
  },
  // trigger uniqueness
  {
    name: 'triggers: refuses a second API trigger',
    base: graph(block(ID.a, 'api_trigger', 'API')),
    operations: [
      { operation_type: 'add', block_id: ID.b, params: { type: 'api_trigger', name: 'API 2' } },
    ],
    target: graph(block(ID.a, 'api_trigger', 'API'), block(ID.b, 'api_trigger', 'API 2')),
    expected: [`duplicate_trigger:${ID.b}`],
  },
  {
    name: 'triggers: refuses a modern trigger beside a legacy starter',
    base: graph(block(ID.a, 'starter', 'Start')),
    operations: [
      { operation_type: 'add', block_id: ID.b, params: { type: 'start_trigger', name: 'Go' } },
    ],
    target: graph(block(ID.a, 'starter', 'Start'), block(ID.b, 'start_trigger', 'Go')),
    expected: [`duplicate_trigger:${ID.b}`],
  },
  {
    name: 'triggers: refuses a second single-instance block',
    base: graph(block(ID.a, 'response', 'Response')),
    operations: [
      { operation_type: 'add', block_id: ID.b, params: { type: 'response', name: 'Response 2' } },
    ],
    target: graph(block(ID.a, 'response', 'Response'), block(ID.b, 'response', 'Response 2')),
    expected: [`duplicate_single_instance_block:${ID.b}`],
  },
  // locked blocks (engine operations.ts:397-473, 960-1180; block-enablement.ts)
  {
    name: 'locked: refuses an input edit on a locked block',
    base: graph(block(ID.a, 'agent', 'A', { locked: true, sub: { systemPrompt: 'old' } })),
    operations: [
      { operation_type: 'edit', block_id: ID.a, params: { inputs: { systemPrompt: 'new' } } },
    ],
    target: graph(block(ID.a, 'agent', 'A', { locked: true, sub: { systemPrompt: 'new' } })),
    expected: [`block_locked:${ID.a}`],
  },
  {
    name: 'locked: refuses renaming a locked block',
    base: graph(block(ID.a, 'agent', 'A', { locked: true })),
    operations: [{ operation_type: 'edit', block_id: ID.a, params: { name: 'Renamed' } }],
    target: graph(block(ID.a, 'agent', 'Renamed', { locked: true })),
    expected: [`block_locked:${ID.a}`],
  },
  {
    name: 'locked: refuses deleting a locked block',
    base: graph(block(ID.a, 'agent', 'A', { locked: true }), block(ID.b, 'agent', 'B')),
    operations: [{ operation_type: 'delete', block_id: ID.a }],
    target: graph(block(ID.b, 'agent', 'B')),
    expected: [`block_locked:${ID.a}`],
  },
  {
    name: 'locked: refuses an edit to a child of a locked container',
    base: lockedLoopBase,
    operations: [
      { operation_type: 'edit', block_id: ID.a, params: { inputs: { systemPrompt: 'new' } } },
    ],
    target: edit(lockedLoopBase, {
      [ID.a]: block(ID.a, 'agent', 'Inner', { parentId: ID.loop, sub: { systemPrompt: 'new' } }),
    }),
    expected: [`block_locked:${ID.a}`],
  },
  {
    name: 'locked: refuses inserting a new block into a locked container',
    base: lockedLoopBase,
    operations: [
      {
        operation_type: 'insert_into_subflow',
        block_id: ID.c,
        params: { type: 'agent', name: 'New', subflowId: ID.loop },
      },
    ],
    target: edit(lockedLoopBase, { [ID.c]: block(ID.c, 'agent', 'New', { parentId: ID.loop }) }),
    expected: [`block_locked:${ID.c}`],
  },
  {
    name: 'locked: refuses moving an existing block into a locked container',
    base: lockedLoopBase,
    operations: [
      {
        operation_type: 'insert_into_subflow',
        block_id: ID.b,
        params: { type: 'agent', name: 'Outside', subflowId: ID.loop },
      },
    ],
    target: edit(lockedLoopBase, {
      [ID.b]: block(ID.b, 'agent', 'Outside', { parentId: ID.loop, sub: { systemPrompt: 'old' } }),
    }),
    expected: [`block_locked:${ID.b}`],
  },
  {
    name: 'locked: refuses extracting a child from a locked container',
    base: lockedLoopBase,
    operations: [
      { operation_type: 'extract_from_subflow', block_id: ID.a, params: { subflowId: ID.loop } },
    ],
    target: edit(lockedLoopBase, {
      [ID.a]: block(ID.a, 'agent', 'Inner', { sub: { systemPrompt: 'old' } }),
    }),
    expected: [`block_locked:${ID.a}`],
  },
  {
    name: 'locked: refuses toggling a locked block',
    base: graph(block(ID.a, 'agent', 'A', { locked: true })),
    enabledChanges: [{ blockId: ID.a, enabled: false }],
    target: graph(block(ID.a, 'agent', 'A', { locked: true, enabled: false })),
    expected: [`block_locked:${ID.a}`],
  },
  {
    name: 'locked: a locked child goes with its deleted unlocked container',
    base: graph(
      block(ID.loop, 'loop', 'Each'),
      block(ID.a, 'agent', 'Inner', { parentId: ID.loop, locked: true })
    ),
    operations: [{ operation_type: 'delete', block_id: ID.loop }],
    target: graph(),
    expected: [],
  },
  // application/apply-workflow-operations.test.ts › enablement
  {
    name: 'enablement: refuses enabling a block under a disabled container',
    base: graph(
      block(ID.loop, 'loop', 'Each', { enabled: false }),
      block(ID.a, 'agent', 'Inner', { parentId: ID.loop, enabled: false })
    ),
    enabledChanges: [{ blockId: ID.a, enabled: true }],
    target: graph(
      block(ID.loop, 'loop', 'Each', { enabled: false }),
      block(ID.a, 'agent', 'Inner', { parentId: ID.loop, enabled: true })
    ),
    expected: [`disabled_ancestor:${ID.a}`],
  },
  // editing/operations.test.ts › Mothership tool attachment writes (copilot authoring contract)
  {
    name: 'copilot: refuses an alias on a new tool binding',
    base: graph(),
    operations: [
      {
        operation_type: 'add',
        block_id: ID.a,
        params: {
          type: 'agent',
          name: 'Agent',
          inputs: { tools: [{ type: 'slack', operation: 'send', title: 'Approved sender' }] },
        },
      },
    ],
    target: graph(
      block(ID.a, 'agent', 'Agent', {
        sub: { tools: [{ type: 'slack', operation: 'send', title: 'Approved sender' }] },
      })
    ),
    isCopilot: true,
    expected: [`invalid_subblock_field:${ID.a}`],
  },
  {
    name: 'copilot: refuses renaming a saved tool binding',
    base: graph(
      block(ID.a, 'agent', 'Agent', {
        sub: { tools: [{ type: 'slack', operation: 'send', title: 'Approved sender' }] },
      })
    ),
    operations: [
      {
        operation_type: 'edit',
        block_id: ID.a,
        params: {
          inputs: { tools: [{ type: 'slack', operation: 'send', title: 'Another name' }] },
        },
      },
    ],
    target: graph(
      block(ID.a, 'agent', 'Agent', {
        sub: { tools: [{ type: 'slack', operation: 'send', title: 'Another name' }] },
      })
    ),
    isCopilot: true,
    expected: [`invalid_subblock_field:${ID.a}`],
  },
  {
    name: 'copilot: refuses an integration selection Sim Chat would ignore',
    base: graph(),
    operations: [
      {
        operation_type: 'add',
        block_id: ID.a,
        params: {
          type: 'mothership',
          name: 'Sim Chat',
          inputs: { tools: [{ type: 'slack', operation: 'send' }] },
        },
      },
    ],
    target: graph(
      block(ID.a, 'mothership', 'Sim Chat', {
        sub: { tools: [{ type: 'slack', operation: 'send' }] },
      })
    ),
    isCopilot: true,
    expected: [`invalid_subblock_field:${ID.a}`],
  },
  // credentials (editing/validation.ts preValidateCredentialInputs)
  {
    name: 'credentials: refuses a credential the user cannot reach, on add and on edit',
    base: graph(block(ID.b, 'jira', 'Jira old', { sub: { credential: 'good-cred' } })),
    operations: [
      {
        operation_type: 'add',
        block_id: ID.a,
        params: { type: 'jira', name: 'Jira', inputs: { credential: 'bad-cred' } },
      },
      { operation_type: 'edit', block_id: ID.b, params: { inputs: { credential: 'bad-cred' } } },
    ],
    target: graph(
      block(ID.a, 'jira', 'Jira', { sub: { credential: 'bad-cred' } }),
      block(ID.b, 'jira', 'Jira old', { sub: { credential: 'bad-cred' } })
    ),
    expected: [`credential:${ID.a}`, `credential:${ID.b}`],
  },
  {
    name: 'credentials: a stored unreachable credential the edit leaves alone is not refused',
    base: graph(block(ID.b, 'jira', 'Jira', { sub: { credential: 'bad-cred' } })),
    operations: [{ operation_type: 'edit', block_id: ID.b, params: { name: 'Jira 2' } }],
    target: graph(block(ID.b, 'jira', 'Jira 2', { sub: { credential: 'bad-cred' } })),
    expected: [],
  },
  // retry eligibility (editing/builders.ts applyBlockRetry)
  {
    name: 'retry: refuses a retry policy on a new human in the loop block',
    base: graph(),
    operations: [
      {
        operation_type: 'add',
        block_id: ID.a,
        params: { type: 'human_in_the_loop', name: 'Approve', retry: RETRY },
      },
    ],
    target: graph(block(ID.a, 'human_in_the_loop', 'Approve', { retry: RETRY })),
    expected: [`retry_not_supported:${ID.a}`],
  },
  {
    name: 'retry: refuses setting a retry policy on a stored human in the loop block',
    base: graph(block(ID.a, 'human_in_the_loop', 'Approve')),
    operations: [{ operation_type: 'edit', block_id: ID.a, params: { retry: RETRY } }],
    target: graph(block(ID.a, 'human_in_the_loop', 'Approve', { retry: RETRY })),
    expected: [`retry_not_supported:${ID.a}`],
  },
  {
    name: 'retry: accepts a retry policy on a block that can retry',
    base: graph(),
    operations: [
      { operation_type: 'add', block_id: ID.a, params: { type: 'agent', name: 'A', retry: RETRY } },
    ],
    target: graph(block(ID.a, 'agent', 'A', { retry: RETRY })),
    expected: [],
  },
  {
    name: 'retry: a stored retry policy the edit leaves alone is not refused',
    base: graph(block(ID.a, 'human_in_the_loop', 'Approve', { retry: RETRY })),
    operations: [{ operation_type: 'edit', block_id: ID.a, params: { name: 'Approve 2' } }],
    target: graph(block(ID.a, 'human_in_the_loop', 'Approve 2', { retry: RETRY })),
    expected: [],
  },
  // sandbox plan (application/apply-workflow-operations.ts)
  {
    name: 'sandbox: refuses selecting a sandbox without the plan',
    base: graph(block(ID.a, 'function', 'Fn', { sub: { code: 'return 1' } })),
    operations: [
      { operation_type: 'edit', block_id: ID.a, params: { inputs: { sandboxId: 'sbx_1' } } },
    ],
    target: graph(block(ID.a, 'function', 'Fn', { sub: { code: 'return 1', sandboxId: 'sbx_1' } })),
    expected: [`sandbox_plan:${ID.a}`],
  },
]

describe('source gates agree with the editing engine', () => {
  beforeEach(() => {
    mockValidateSelectorIds.mockImplementation(async (_type: string, ids: string | string[]) => {
      const list = Array.isArray(ids) ? ids : [ids]
      return {
        valid: list.filter((id) => id !== 'bad-cred'),
        invalid: list.filter((id) => id === 'bad-cred'),
      }
    })
    billingSubscriptionMockFns.mockHasWorkspaceSandboxAccess.mockResolvedValue(false)
  })

  it.each(CASES)('$name', async (testCase) => {
    const [engine, source] = await Promise.all([engineRefusals(testCase), sourceRefusals(testCase)])
    expect(engine).toEqual([...testCase.expected].sort())
    expect(source).toEqual(engine)
  })

  describe('on hosted Sim', () => {
    beforeEach(() => {
      vi.spyOn(providerModels, 'getHostedModels').mockReturnValue(['claude-sonnet-4-6'])
      setEnvFlags({ isHosted: true })
    })
    afterEach(() => {
      resetEnvFlagsMock()
    })

    it('reports a user API key set on a hosted model', async () => {
      const testCase: ParityCase = {
        name: 'hosted key',
        base: graph(),
        operations: [
          {
            operation_type: 'add',
            block_id: ID.a,
            params: {
              type: 'agent',
              name: 'Agent',
              inputs: { model: 'claude-sonnet-4-6', apiKey: 'user-key' },
            },
          },
        ],
        target: graph(
          block(ID.a, 'agent', 'Agent', { sub: { model: 'claude-sonnet-4-6', apiKey: 'user-key' } })
        ),
        expected: [`hosted_key:${ID.a}`],
      }
      const [engine, source] = await Promise.all([
        engineRefusals(testCase),
        sourceRefusals(testCase),
      ])
      expect(engine).toEqual(testCase.expected)
      expect(source).toEqual(engine)
    })
  })
})

function gate(
  base: SourceGraph,
  target: SourceGraph,
  permissionConfig: PermissionGroupConfig | null
) {
  return gateSourceDiff({
    ...SOURCE_SCOPE,
    base,
    target,
    diff: diffGraphs(base, target),
    permissionConfig,
    subjectUserId: CTX.userId,
    workspaceId: CTX.workspaceId,
    isCopilot: false,
  })
}

function refusalCodes(diagnostics: { code: string; severity: string }[]): string[] {
  return diagnostics.filter((d) => d.severity === 'error').map((d) => d.code)
}

describe('gateSourceDiff: tool-input fields other than tools', () => {
  const denyCanvasTool = { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedTools: ['slack_canvas'] }

  it('refuses a denied tool added to a human in the loop notification', async () => {
    const base = graph(block(ID.a, 'human_in_the_loop', 'Approve'))
    const target = graph(
      block(ID.a, 'human_in_the_loop', 'Approve', {
        sub: { notification: [{ type: 'slack', operation: 'canvas', title: 'Notify' }] },
      })
    )
    expect(refusalCodes(await gate(base, target, denyCanvasTool))).toEqual([
      'E_APPLY_TOOL_NOT_ALLOWED',
    ])
  })

  it('refuses a new human in the loop block whose notification holds a denied tool', async () => {
    const target = graph(
      block(ID.a, 'human_in_the_loop', 'Approve', {
        sub: { notification: [{ type: 'slack', operation: 'canvas', title: 'Notify' }] },
      })
    )
    expect(refusalCodes(await gate(graph(), target, denyCanvasTool))).toEqual([
      'E_APPLY_TOOL_NOT_ALLOWED',
    ])
  })

  it('keeps a denied notification tool already stored when the edit leaves it alone', async () => {
    const notification = [{ type: 'slack', operation: 'canvas', title: 'Notify' }]
    const base = graph(block(ID.a, 'human_in_the_loop', 'Approve', { sub: { notification } }))
    const target = graph(
      block(ID.a, 'human_in_the_loop', 'Approve', {
        sub: {
          notification: [...notification, { type: 'slack', operation: 'send', title: 'Also' }],
        },
      })
    )
    expect(refusalCodes(await gate(base, target, denyCanvasTool))).toEqual([])
  })
})

describe('gateSourceDiff: a retyped block is gated on every value it keeps', () => {
  it('refuses an unchanged operation the new type maps to a denied tool', async () => {
    const base = graph(block(ID.a, 'slack', 'Slack', { sub: { operation: 'canvas' } }))
    const target = graph(block(ID.a, 'slack_v2', 'Slack', { sub: { operation: 'canvas' } }))
    const denyV2Canvas = { ...DEFAULT_PERMISSION_GROUP_CONFIG, deniedTools: ['slack_v2_canvas'] }
    expect(refusalCodes(await gate(base, target, denyV2Canvas))).toEqual([
      'E_APPLY_TOOL_NOT_ALLOWED',
    ])
  })

  it('refuses an unchanged credential the user cannot reach under the new type', async () => {
    mockValidateSelectorIds.mockImplementation(async (_type: string, ids: string | string[]) => {
      const list = Array.isArray(ids) ? ids : [ids]
      return { valid: [], invalid: list }
    })
    const base = graph(block(ID.a, 'jira', 'Jira', { sub: { credential: 'bad-cred' } }))
    const target = graph(block(ID.a, 'jira_v2', 'Jira', { sub: { credential: 'bad-cred' } }))
    expect(refusalCodes(await gate(base, target, DEFAULT_PERMISSION_GROUP_CONFIG))).toEqual([
      'E_APPLY_CREDENTIAL_UNREACHABLE',
    ])
  })
})

describe('gateSourceDiff', () => {
  it('lets a sandbox selection through when the workspace has the plan', async () => {
    billingSubscriptionMockFns.mockHasWorkspaceSandboxAccess.mockResolvedValue(true)
    const base = graph(block(ID.a, 'function', 'Fn'))
    const target = graph(block(ID.a, 'function', 'Fn', { sub: { sandboxId: 'sbx_1' } }))
    const diagnostics = await gate(base, target, null)
    expect(diagnostics).toEqual([])
  })

  it('warns, without refusing, when an allowed block changes type', async () => {
    const base = graph(block(ID.a, 'table_v2', 'Rows'))
    const target = graph(block(ID.a, 'agent', 'Rows'))
    const diagnostics = await gate(base, target, null)
    expect(diagnostics.map((d) => d.code)).toEqual(['W_APPLY_TYPE_CHANGED'])
  })

  it('refuses retyping a block into a duplicate trigger, which the engine never checks', async () => {
    const base = graph(block(ID.a, 'api_trigger', 'API'), block(ID.b, 'agent', 'Agent'))
    const target = graph(block(ID.a, 'api_trigger', 'API'), block(ID.b, 'api_trigger', 'Agent'))
    const diagnostics = await gate(base, target, null)
    expect(diagnostics.map((d) => d.code)).toContain('E_APPLY_DUPLICATE_TRIGGER')
  })

  it('accepts replacing a trigger in one apply', async () => {
    const base = graph(block(ID.a, 'api_trigger', 'API'))
    const target = graph(block(ID.b, 'api_trigger', 'API'))
    const diagnostics = await gate(base, target, null)
    expect(diagnostics).toEqual([])
  })
})

/**
 * Source apply runs every gate in `BLOCK_GATES` through the same runners as the engine, so a new
 * gate applies to both. What can still drift is the skip vocabulary: a gate reporting a type with
 * no apply code would throw inside `gateSourceDiff` at runtime, and an apply code no gate and no
 * source-side check produces is dead.
 */
describe('BLOCK_GATES totality', () => {
  /** Apply codes produced by source checks outside `BLOCK_GATES`, each by its own engine function. */
  const OUTSIDE_THE_GATES = [
    'block_not_found',
    'block_locked',
    'invalid_edge_source',
    'invalid_edge_scope',
    'invalid_source_handle',
    'invalid_target_handle',
    'invalid_subblock_field',
    'missing_required_params',
    'disabled_ancestor',
  ]
  const gateSkipTypes = new Set<string>(BLOCK_GATES.flatMap((gate) => gate.skipTypes))

  it('maps every skip type a gate reports to an apply code', () => {
    const unmapped = [...gateSkipTypes].filter(
      (type) => !Object.hasOwn(SKIP_TYPE_APPLY_CODES, type)
    )
    expect(unmapped).toEqual([])
  })

  it('accounts for every apply code as a gate or a named check outside the gates', () => {
    const unaccounted = Object.keys(SKIP_TYPE_APPLY_CODES).filter(
      (type) => !gateSkipTypes.has(type) && !OUTSIDE_THE_GATES.includes(type)
    )
    const overlapping = OUTSIDE_THE_GATES.filter((type) => gateSkipTypes.has(type))
    expect({ unaccounted, overlapping }).toEqual({ unaccounted: [], overlapping: [] })
  })
})
