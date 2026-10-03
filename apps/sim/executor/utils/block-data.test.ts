import { describe, expect, it, vi } from 'vitest'
import { getBlockSchema } from '@/executor/utils/block-data'
import { resolveBlockReference } from '@/executor/utils/block-reference'
import type { SerializedBlock } from '@/serializer/types'

/**
 * These assertions are about what the real block registry publishes, so the global stub — which
 * returns one mock block with no outputs — would make every case here pass vacuously. Only the
 * generic webhook block is read, so only it is registered.
 */
vi.unmock('@/blocks/registry')
vi.mock('@/blocks/registry-maps', async () => {
  const { partialBlockRegistry } = await import('@sim/testing/mocks/block-registry.mock')
  return partialBlockRegistry(await import('@/blocks/blocks/generic_webhook'))
})

function triggerBlock(type: string, params: Record<string, unknown> = {}): SerializedBlock {
  return {
    id: 'trigger-1',
    metadata: { id: type, name: 'webhook1', category: 'triggers' },
    position: { x: 0, y: 0 },
    config: { tool: '', params },
    inputs: {},
    outputs: {},
    enabled: true,
  } as unknown as SerializedBlock
}

function resolve(
  pathParts: string[],
  schema: ReturnType<typeof getBlockSchema>
): ReturnType<typeof resolveBlockReference> {
  return resolveBlockReference(
    'webhook1',
    pathParts,
    {
      blockNameMapping: { webhook1: 'trigger-1' },
      blockData: { 'trigger-1': { query: { env: 'prod' } } },
      blockOutputSchemas: schema ? { 'trigger-1': schema } : {},
    } as never,
    {} as never
  )
}

describe('generic webhook output schema', () => {
  it.each([
    [{}, 'no flags set'],
    [{ acceptOtherMethods: true, exposeRequestHeaders: true }, 'both request-metadata flags on'],
  ])('stays open with %o (%s)', (params) => {
    expect(getBlockSchema(triggerBlock('generic_webhook', params))).toBeUndefined()
  })

  /**
   * The production regression this pins: a Slack interactive payload reaching a workflow that
   * reads `actions.0.selected_option.value`. When a delivery omits the field the reference must
   * resolve to `undefined` so the condition simply evaluates falsy — not abort the run.
   */
  it('resolves an absent body field to undefined instead of throwing', () => {
    const schema = getBlockSchema(triggerBlock('generic_webhook'))

    expect(() => resolve(['actions', '0', 'selected_option', 'value'], schema)).not.toThrow()
    expect(resolve(['actions', '0', 'selected_option', 'value'], schema)?.value).toBeUndefined()
  })

  it('still resolves request metadata the provider merges into the input', () => {
    const schema = getBlockSchema(triggerBlock('generic_webhook'))

    expect(resolve(['query', 'env'], schema)?.value).toBe('prod')
  })
})
