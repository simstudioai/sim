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
 * `slack_v2` is `preview`-gated while `slack` v1 deliberately stays in the
 * toolbar so a workspace has a Slack block during the gate. Resolving the
 * detail to the newest version and then hiding it answered `404` for a type
 * `GET /api/v2/blocks` was publishing in the same breath.
 */
describe('version resolution for a viewer', () => {
  it.each(['slack', 'table'])(
    'resolves %s to a version the unrevealed viewer can actually see',
    async (type) => {
      const { getLatestBlockForViewer, getAllBlocks } = await import('@/blocks/registry')

      const detail = getLatestBlockForViewer(type)
      const listed = getAllBlocks().find(
        (block) =>
          !block.hideFromToolbar && (block.type === type || block.type.startsWith(`${type}_v`))
      )

      expect(Boolean(detail)).toBe(Boolean(listed))
      if (detail && listed) expect(detail.type).toBe(listed.type)
    }
  )
})
