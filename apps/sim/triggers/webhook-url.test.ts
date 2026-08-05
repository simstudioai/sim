/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'
import {
  INTERNAL_TRIGGER_PROVIDERS,
  isInternalTriggerProvider,
  isPollingWebhookProvider,
  POLLING_PROVIDERS,
} from '@/triggers/constants'
import { TRIGGER_REGISTRY } from '@/triggers/registry'
import { blockAdvertisesWebhookUrl } from '@/triggers/webhook-url'

function block(overrides: Partial<BlockState> = {}): BlockState {
  return {
    id: 'blk',
    type: 'slack',
    name: 'Slack',
    subBlocks: {},
    outputs: {},
    enabled: true,
    ...overrides,
  } as unknown as BlockState
}

describe('blockAdvertisesWebhookUrl', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is true for a trigger block with an unconditional webhook-URL field', () => {
    vi.mocked(getBlock).mockReturnValue({
      category: 'triggers',
      subBlocks: [{ id: 'triggerWebhookUrl', useWebhookUrl: true }],
    } as never)
    expect(blockAdvertisesWebhookUrl(block())).toBe(true)
  })

  it('is false for a trigger block that declares no webhook-URL field (poller, schedule, chat)', () => {
    vi.mocked(getBlock).mockReturnValue({
      category: 'triggers',
      subBlocks: [{ id: 'cron' }],
    } as never)
    expect(blockAdvertisesWebhookUrl(block())).toBe(false)
  })

  it('is false for a non-trigger block, even one whose config declares a URL field', () => {
    vi.mocked(getBlock).mockReturnValue({
      category: 'blocks',
      subBlocks: [{ id: 'triggerWebhookUrl', useWebhookUrl: true }],
    } as never)
    expect(blockAdvertisesWebhookUrl(block())).toBe(false)
  })

  it('is true for a tool block flipped into trigger mode', () => {
    vi.mocked(getBlock).mockReturnValue({
      category: 'blocks',
      subBlocks: [{ id: 'triggerWebhookUrl', useWebhookUrl: true }],
    } as never)
    expect(blockAdvertisesWebhookUrl(block({ triggerMode: true } as never))).toBe(true)
  })

  /**
   * The case a trigger-definition flag cannot express: one block hosts several triggers, and only
   * some of them serve a URL. Reading the ACTIVE condition is what keeps a block currently set to
   * the polling trigger from claiming a URL its webhook sibling would have.
   */
  it('honours the selectedTriggerId condition on a multi-trigger block', () => {
    vi.mocked(getBlock).mockReturnValue({
      category: 'triggers',
      subBlocks: [
        {
          id: 'webhookUrl',
          useWebhookUrl: true,
          condition: { field: 'selectedTriggerId', value: 'service_webhook' },
        },
      ],
    } as never)
    const pollingBlock = block({
      subBlocks: { selectedTriggerId: { id: 'selectedTriggerId', value: 'service_poller' } },
    } as never)
    const webhookBlock = block({
      subBlocks: { selectedTriggerId: { id: 'selectedTriggerId', value: 'service_webhook' } },
    } as never)
    expect(blockAdvertisesWebhookUrl(pollingBlock)).toBe(false)
    expect(blockAdvertisesWebhookUrl(webhookBlock)).toBe(true)
  })

  it('is false when the block type is not in the registry', () => {
    vi.mocked(getBlock).mockReturnValue(undefined as never)
    expect(blockAdvertisesWebhookUrl(block())).toBe(false)
  })
})

/**
 * The two provider registries and the per-subblock `useWebhookUrl` marker must agree on which
 * triggers serve a public URL. `POLLING_PROVIDERS` is already pinned against `polling: true` in
 * `constants.test.ts`; this closes the remaining gap - a trigger whose events Sim pulls, or whose
 * path the public route rejects, must never also advertise a URL to paste into a provider console.
 */
describe('provider registries agree with the webhook-URL marker', () => {
  it('no polling or internal trigger declares a webhook-URL sub-block', () => {
    const offenders = Object.values(TRIGGER_REGISTRY)
      .filter(
        (trigger) =>
          isPollingWebhookProvider(trigger.provider) || isInternalTriggerProvider(trigger.provider)
      )
      .filter((trigger) => trigger.subBlocks.some((subBlock) => subBlock.useWebhookUrl === true))
      .map((trigger) => `${trigger.id} (provider: ${trigger.provider})`)

    expect(
      offenders,
      'A polling/internal trigger advertising a webhook URL would offer a path nothing external can call'
    ).toEqual([])
  })

  it('keeps both registries non-empty, so neither guard can pass vacuously', () => {
    expect(POLLING_PROVIDERS.size).toBeGreaterThan(0)
    expect(INTERNAL_TRIGGER_PROVIDERS.size).toBeGreaterThan(0)
  })
})
