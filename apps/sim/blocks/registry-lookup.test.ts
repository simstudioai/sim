/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

// The suite-wide mock stubs the registry; this file is about the real lookup.
vi.unmock('@/blocks/registry')

const { getBlock } = await import('@/blocks/registry')

/**
 * `BLOCK_REGISTRY` is an object literal, so a bare bracket lookup answers every
 * inherited `Object.prototype` member with a function. Those are truthy and
 * carry no `type`, so a consumer that trusts the lookup reads `undefined.type`
 * and throws — turning a caller-supplied path segment into a 500 on a
 * well-formed request. `GET /api/v2/blocks/{blockId}` accepts any string, which
 * is what makes this reachable rather than theoretical.
 */
describe('getBlock prototype safety', () => {
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf'])(
    'answers %s with undefined rather than an inherited member',
    (key) => {
      expect(getBlock(key)).toBeUndefined()
    }
  )

  it('still resolves a real block', () => {
    const block = getBlock('agent')
    expect(block?.type).toBe('agent')
  })
})

/**
 * The list and the detail read must agree about a type.
 *
 * A preview successor can be hidden while its released base version remains in
 * the toolbar. Resolving the detail to the newest version and then hiding it
 * would answer `404` for a type `GET /api/v2/blocks` publishes in the same
 * breath. Once the successor is released, both surfaces must resolve to it.
 */
describe('version resolution for a viewer', () => {
  it('falls back to the released table block while table_v2 is unrevealed', async () => {
    const { getLatestBlockForViewer, getAllBlocks } = await import('@/blocks/registry')
    const detail = getLatestBlockForViewer('table')
    const listed = getAllBlocks().find(
      (block) =>
        !block.hideFromToolbar && (block.type === 'table' || block.type.startsWith('table_v'))
    )

    expect(detail?.type).toBe('table')
    expect(listed?.type).toBe('table')
  })

  it('resolves Slack to the released slack_v2 block', async () => {
    const { getLatestBlockForViewer, getAllBlocks } = await import('@/blocks/registry')
    const detail = getLatestBlockForViewer('slack')
    const listed = getAllBlocks().find(
      (block) =>
        !block.hideFromToolbar && (block.type === 'slack' || block.type.startsWith('slack_v'))
    )

    expect(detail?.type).toBe('slack_v2')
    expect(listed?.type).toBe('slack_v2')
  })
})
