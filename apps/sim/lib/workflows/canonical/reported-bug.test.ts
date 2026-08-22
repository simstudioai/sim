/**
 * @vitest-environment node
 *
 * The block shape from the originally reported workflow. Identifiers are
 * replaced; the stored subblock spelling is reproduced exactly, because that is
 * the part that carries the bug.
 *
 * `provider-config-round-trip.test.ts` asserts the same property across the whole
 * registry and is the stronger guard, but it synthesizes its blocks. This one
 * pins the combination a real deployment actually held: `verifyTestEvents`
 * stored as `null`, `acceptOtherMethods` / `exposeRequestHeaders` absent
 * entirely because the workflow predates #6893, `responseMode` explicitly set
 * away from its default, and `inputFormat` as an empty array rather than null.
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * The canonical form reads declared defaults, so the globally-mocked registry
 * (every block reduced to `subBlocks: []`) would make this pass vacuously.
 */
vi.unmock('@/blocks/registry')

import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const deployedWebhookBlock = {
  id: 'webhook-block',
  type: 'generic_webhook',
  name: 'Webhook',
  position: { x: 150, y: 143.65 },
  subBlocks: {
    token: { id: 'token', type: 'short-input', value: null },
    inputFormat: { id: 'inputFormat', type: 'input-format', value: [] },
    requireAuth: { id: 'requireAuth', type: 'switch', value: false },
    responseBody: { id: 'responseBody', type: 'code', value: null },
    responseMode: { id: 'responseMode', type: 'dropdown', value: 'custom' },
    idempotencyField: { id: 'idempotencyField', type: 'short-input', value: null },
    secretHeaderName: { id: 'secretHeaderName', type: 'short-input', value: null },
    verifyTestEvents: { id: 'verifyTestEvents', type: 'switch', value: null },
    responseStatusCode: { id: 'responseStatusCode', type: 'short-input', value: '200' },
  },
  outputs: {},
  enabled: true,
  horizontalHandles: true,
  height: 48,
  advancedMode: false,
  errorEnabled: false,
  triggerMode: true,
  data: {},
  locked: false,
}

/**
 * What focusing the block produces: `useWebhookManagement` reads the deployed
 * `webhook.providerConfig` — into which deploy materialized every declared
 * default — and writes it back through `mergeSubblockStateWithValues`, which
 * creates a structure entry for any non-null value.
 */
const liveWebhookBlockAfterFocus = {
  ...deployedWebhookBlock,
  subBlocks: {
    ...deployedWebhookBlock.subBlocks,
    verifyTestEvents: { id: 'verifyTestEvents', type: 'switch', value: false },
    acceptOtherMethods: { id: 'acceptOtherMethods', type: 'short-input', value: false },
    exposeRequestHeaders: { id: 'exposeRequestHeaders', type: 'short-input', value: false },
  },
}

function stateWith(block: Record<string, unknown>): WorkflowState {
  return {
    blocks: { [block.id as string]: block },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  } as unknown as WorkflowState
}

describe('generic_webhook focus (the reported bug)', () => {
  it('does not report a change when deploy-materialized defaults are read back', () => {
    const summary = generateWorkflowDiffSummary(
      stateWith(liveWebhookBlockAfterFocus),
      stateWith(deployedWebhookBlock)
    )

    expect(summary.modifiedBlocks).toEqual([])
    expect(summary.hasChanges).toBe(false)
  })

  it('still reports a change the user actually made', () => {
    const edited = {
      ...deployedWebhookBlock,
      subBlocks: {
        ...deployedWebhookBlock.subBlocks,
        responseStatusCode: { id: 'responseStatusCode', type: 'short-input', value: '418' },
      },
    }

    const summary = generateWorkflowDiffSummary(stateWith(edited), stateWith(deployedWebhookBlock))

    expect(summary.hasChanges).toBe(true)
    expect(summary.modifiedBlocks[0]?.changes.map((c) => c.field)).toEqual(['responseStatusCode'])
  })

  it('reports a defaulted switch the user deliberately turned ON', () => {
    const enabled = {
      ...deployedWebhookBlock,
      subBlocks: {
        ...deployedWebhookBlock.subBlocks,
        acceptOtherMethods: { id: 'acceptOtherMethods', type: 'switch', value: true },
      },
    }

    const summary = generateWorkflowDiffSummary(stateWith(enabled), stateWith(deployedWebhookBlock))

    expect(summary.hasChanges).toBe(true)
    expect(summary.modifiedBlocks[0]?.changes.map((c) => c.field)).toEqual(['acceptOtherMethods'])
  })
})
