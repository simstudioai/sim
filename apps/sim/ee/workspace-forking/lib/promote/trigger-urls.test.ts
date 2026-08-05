/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'
import type { ForkTargetWebhook } from '@/ee/workspace-forking/lib/copy/deploy-bridge'
import {
  buildForkTriggerPlan,
  type ForkTriggerMappingInput,
  resolveForkTriggerPaths,
} from '@/ee/workspace-forking/lib/promote/trigger-urls'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** A webhook trigger: `useWebhookUrl` is what marks a block as serving a public URL. */
const TRIGGER_BLOCK = {
  name: 'Slack',
  description: '',
  category: 'triggers',
  subBlocks: [{ id: 'triggerWebhookUrl', useWebhookUrl: true }],
}

/** A trigger with no public URL - a poller, schedule, or chat trigger. */
const URL_LESS_TRIGGER_BLOCK = { ...TRIGGER_BLOCK, subBlocks: [{ id: 'cron' }] }

function stateWith(blocks: Record<string, { type: string; name: string }>): WorkflowState {
  return {
    blocks: Object.fromEntries(
      Object.entries(blocks).map(([id, block]) => [
        id,
        { id, type: block.type, name: block.name, subBlocks: {}, outputs: {}, enabled: true },
      ])
    ),
    edges: [],
    loops: {},
    parallels: {},
  } as unknown as WorkflowState
}

const item = {
  sourceWorkflowId: 'wf-src',
  targetWorkflowId: 'wf-tgt',
  targetName: 'Prod',
  mode: 'replace' as const,
  sourceMeta: {
    name: 'Prod',
    description: null,
    folderId: null,
    sortOrder: 0,
    isPublicApi: false,
  },
}

/** Identity resolver: the source block keeps its id in the target (the stable-pairing case). */
const identityResolver = (_targetWorkflowId: string, sourceBlockId: string) => sourceBlockId

function webhooks(entries: Array<[string, ForkTargetWebhook]>) {
  return new Map(entries)
}

function run(
  blocks: Record<string, { type: string; name: string }>,
  targetWebhooks: Map<string, ForkTargetWebhook>,
  overrides?: ForkTriggerMappingInput[]
) {
  const plan = buildForkTriggerPlan({
    items: [item],
    sourceStates: new Map([['wf-src', stateWith(blocks)]]),
    resolveBlockId: identityResolver,
    targetWebhooks,
  })
  return { plan, ...resolveForkTriggerPaths(plan, overrides) }
}

/**
 * Blocks use the REAL `slack_webhook` trigger id, so provider resolution runs against the actual
 * trigger registry (provider `slack`) rather than a mock that could drift from it.
 */
describe('fork trigger URLs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getBlock).mockReturnValue(TRIGGER_BLOCK as never)
  })

  it('pins a trigger that keeps its target identity to its own path, reporting no change', () => {
    const { pathByTargetBlockId, changes, plan } = run(
      { blk: { type: 'slack_webhook', name: 'Slack' } },
      webhooks([['blk', { path: 'custom-path', workflowId: 'wf-tgt', provider: 'slack' }]])
    )
    expect(changes).toEqual([])
    expect(pathByTargetBlockId.get('blk')).toBe('custom-path')
    // Nothing to decide: the block already serves a URL, so it offers no alternatives.
    expect(plan.slots[0].adoptablePaths).toEqual([])
  })

  /**
   * The reported bug: a trigger deleted and re-added in the source re-keys the target block, which
   * used to mint a new URL. The single arriving trigger now adopts the retiring URL instead.
   */
  it('adopts a retiring URL onto the single arriving trigger that replaces it', () => {
    const { pathByTargetBlockId, changes, plan } = run(
      { blk2: { type: 'slack_webhook', name: 'Slack v2' } },
      webhooks([['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'slack' }]])
    )
    expect(plan.slots[0].defaultAdoptPath).toBe('blk1')
    expect(pathByTargetBlockId.get('blk2')).toBe('blk1')
    // Adopted means still served — there is nothing for the user to re-register.
    expect(changes).toEqual([])
  })

  it('reports a removal when the trigger is gone from the source entirely', () => {
    vi.mocked(getBlock).mockReturnValue({ ...TRIGGER_BLOCK, category: 'blocks' } as never)
    const { pathByTargetBlockId, changes } = run(
      { fn: { type: 'function', name: 'Fn' } },
      webhooks([['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'slack' }]])
    )
    expect(changes).toEqual([{ workflowName: 'Prod', path: 'blk1' }])
    expect(pathByTargetBlockId.size).toBe(0)
  })

  it('does not guess a pairing when several URLs retire at once', () => {
    const { pathByTargetBlockId, changes, plan } = run(
      { blk3: { type: 'slack_webhook', name: 'Slack' } },
      webhooks([
        ['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'slack' }],
        ['blk2', { path: 'blk2', workflowId: 'wf-tgt', provider: 'slack' }],
      ])
    )
    expect(plan.slots[0].defaultAdoptPath).toBeNull()
    // Both are offered, so the user can resolve the ambiguity; neither is taken by default.
    expect(plan.slots[0].adoptablePaths).toEqual(['blk1', 'blk2'])
    expect(pathByTargetBlockId.size).toBe(0)
    expect(changes.map((change) => change.path)).toEqual(['blk1', 'blk2'])
  })

  it('honours an explicit pick when the pairing is ambiguous', () => {
    const { pathByTargetBlockId, changes } = run(
      { blk3: { type: 'slack_webhook', name: 'Slack' } },
      webhooks([
        ['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'slack' }],
        ['blk2', { path: 'blk2', workflowId: 'wf-tgt', provider: 'slack' }],
      ]),
      [{ sourceBlockId: 'blk3', adoptPath: 'blk2' }]
    )
    expect(pathByTargetBlockId.get('blk3')).toBe('blk2')
    expect(changes.map((change) => change.path)).toEqual(['blk1'])
  })

  it('lets an explicit null override the default and mint a new URL', () => {
    const { pathByTargetBlockId, changes } = run(
      { blk2: { type: 'slack_webhook', name: 'Slack v2' } },
      webhooks([['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'slack' }]]),
      [{ sourceBlockId: 'blk2', adoptPath: null }]
    )
    expect(pathByTargetBlockId.size).toBe(0)
    expect(changes).toEqual([{ workflowName: 'Prod', path: 'blk1' }])
  })

  /** A crafted payload must not be able to move a URL the plan never offered. */
  it('ignores an override naming a path this slot does not offer', () => {
    const { pathByTargetBlockId } = run(
      { blk2: { type: 'slack_webhook', name: 'Slack v2' } },
      webhooks([['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'slack' }]]),
      [{ sourceBlockId: 'blk2', adoptPath: 'a-path-from-another-workspace' }]
    )
    expect(pathByTargetBlockId.size).toBe(0)
  })

  it('never lets two triggers adopt the same path', () => {
    const { pathByTargetBlockId } = run(
      {
        blk2: { type: 'slack_webhook', name: 'Slack A' },
        blk3: { type: 'slack_webhook', name: 'Slack B' },
      },
      webhooks([['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'slack' }]]),
      [
        { sourceBlockId: 'blk2', adoptPath: 'blk1' },
        { sourceBlockId: 'blk3', adoptPath: 'blk1' },
      ]
    )
    expect(Array.from(pathByTargetBlockId.values())).toEqual(['blk1'])
    expect(pathByTargetBlockId.get('blk2')).toBe('blk1')
  })

  /**
   * A path is authenticated and parsed as its provider. Handing a GitHub URL to an arriving Slack
   * trigger would keep the endpoint alive while every request failed signature verification — and
   * the sync would have reported the URL as preserved, so nobody would go looking.
   */
  it('never offers a retiring URL from a DIFFERENT provider', () => {
    const { plan, pathByTargetBlockId, changes } = run(
      { blk2: { type: 'slack_webhook', name: 'Slack v2' } },
      webhooks([['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'github' }]])
    )
    expect(plan.slots[0].adoptablePaths).toEqual([])
    expect(plan.slots[0].defaultAdoptPath).toBeNull()
    expect(pathByTargetBlockId.size).toBe(0)
    // Still reported as lost, so the GitHub subscription's owner is told it stopped serving.
    expect(changes).toEqual([{ workflowName: 'Prod', path: 'blk1' }])
  })

  it('pairs only within the matching provider when several URLs retire', () => {
    const { plan, pathByTargetBlockId } = run(
      { blk3: { type: 'slack_webhook', name: 'Slack' } },
      webhooks([
        ['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'github' }],
        ['blk2', { path: 'blk2', workflowId: 'wf-tgt', provider: 'slack' }],
      ])
    )
    // Only the same-provider URL is a candidate, which makes the pairing unambiguous again.
    expect(plan.slots[0].adoptablePaths).toEqual(['blk2'])
    expect(pathByTargetBlockId.get('blk3')).toBe('blk2')
  })

  /**
   * Adoption is scoped to one target workflow because `webhook_path_claim` ownership is
   * per-workflow: taking a path from another workflow would be an ownership transfer the claim
   * layer refuses, so it must never be offered.
   */
  it('never offers a path owned by a different workflow', () => {
    const { plan, pathByTargetBlockId, changes } = run(
      { blk: { type: 'slack_webhook', name: 'Slack' } },
      webhooks([['other', { path: 'other', workflowId: 'wf-elsewhere', provider: 'slack' }]])
    )
    expect(plan.slots[0].adoptablePaths).toEqual([])
    expect(pathByTargetBlockId.size).toBe(0)
    expect(changes).toEqual([])
  })

  it('skips a non-trigger block arriving on a target block with no webhook', () => {
    vi.mocked(getBlock).mockReturnValue({ ...TRIGGER_BLOCK, category: 'blocks' } as never)
    const { plan } = run(
      { fn: { type: 'function', name: 'Fn' } },
      webhooks([['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'slack' }]])
    )
    expect(plan.slots).toEqual([])
  })

  /**
   * A poller or schedule trigger has no public URL, so handing it a retiring one would point an
   * external caller at a path its provider never serves.
   */
  it('never offers a retiring URL to a trigger that serves no public URL', () => {
    vi.mocked(getBlock).mockReturnValue(URL_LESS_TRIGGER_BLOCK as never)
    const { plan, pathByTargetBlockId, changes } = run(
      { poller: { type: 'gmail', name: 'Gmail poller' } },
      webhooks([['blk1', { path: 'blk1', workflowId: 'wf-tgt', provider: 'slack' }]])
    )
    expect(plan.slots).toEqual([])
    expect(pathByTargetBlockId.size).toBe(0)
    // The URL still retires and is still reported - it just has no eligible adopter.
    expect(changes).toEqual([{ workflowName: 'Prod', path: 'blk1' }])
  })
})
