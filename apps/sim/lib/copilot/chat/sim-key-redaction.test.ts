/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'
import {
  captureRevealedSimKeys,
  extractRevealedSimKeys,
  restoreRevealedSimKeysForMessage,
} from './sim-key-redaction'

const credential = (value: string) =>
  `<credential>${JSON.stringify({ value, type: 'sim_key' })}</credential>`
const redacted = `<credential>${JSON.stringify({ type: 'sim_key', redacted: true })}</credential>`

describe('sim-key-redaction', () => {
  describe('extractRevealedSimKeys', () => {
    it('returns sim_key values in document order', () => {
      const text = `first ${credential('sk-sim-A')} mid ${credential('sk-sim-B')}`
      expect(extractRevealedSimKeys(text)).toEqual(['sk-sim-A', 'sk-sim-B'])
    })

    it('skips redacted entries and non-sim_key tags', () => {
      const link = `<credential>${JSON.stringify({ value: 'https://x', type: 'link', provider: 'slack' })}</credential>`
      const text = `${link} ${credential('sk-sim-A')} ${redacted}`
      expect(extractRevealedSimKeys(text)).toEqual(['sk-sim-A'])
    })
  })

  describe('captureRevealedSimKeys', () => {
    it('records new keys under each provided key', () => {
      const cache = new Map<string, string[]>()
      captureRevealedSimKeys(cache, ['msg-1', 'req-1'], credential('sk-sim-A'))
      expect(cache.get('msg-1')).toEqual(['sk-sim-A'])
      expect(cache.get('req-1')).toEqual(['sk-sim-A'])
    })

    it('extends but never shrinks the captured list across calls', () => {
      const cache = new Map<string, string[]>()
      captureRevealedSimKeys(
        cache,
        ['msg-1'],
        `${credential('sk-sim-A')} ${credential('sk-sim-B')}`
      )
      captureRevealedSimKeys(cache, ['msg-1'], credential('sk-sim-A'))
      expect(cache.get('msg-1')).toEqual(['sk-sim-A', 'sk-sim-B'])
    })

    it('skips undefined keys without throwing', () => {
      const cache = new Map<string, string[]>()
      captureRevealedSimKeys(cache, ['msg-1', undefined], credential('sk-sim-A'))
      expect(cache.get('msg-1')).toEqual(['sk-sim-A'])
      expect(cache.size).toBe(1)
    })

    it('ignores content with no credential tag', () => {
      const cache = new Map<string, string[]>()
      captureRevealedSimKeys(cache, ['msg-1'], 'plain assistant text')
      expect(cache.has('msg-1')).toBe(false)
    })
  })

  describe('restoreRevealedSimKeysForMessage', () => {
    it('substitutes the live key back into a redacted message', () => {
      const cache = new Map<string, string[]>([['msg-1', ['sk-sim-A']]])
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: `Here is your key: ${redacted} save it.`,
        contentBlocks: [{ type: 'text', content: `Here is your key: ${redacted} save it.` }],
      }
      const restored = restoreRevealedSimKeysForMessage(msg, cache)
      expect(restored.content).toContain('"sk-sim-A"')
      expect(restored.content).not.toContain('"redacted":true')
      expect(restored.contentBlocks?.[0].content).toContain('"sk-sim-A"')
    })

    it('substitutes multiple keys in stream order', () => {
      const cache = new Map<string, string[]>([['msg-1', ['sk-sim-A', 'sk-sim-B']]])
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: `first ${redacted} second ${redacted}`,
      }
      const restored = restoreRevealedSimKeysForMessage(msg, cache)
      expect(restored.content).toBe(
        `first ${credential('sk-sim-A')} second ${credential('sk-sim-B')}`
      )
    })

    it('leaves a redacted tag in place if no live value is captured for that slot', () => {
      const cache = new Map<string, string[]>([['msg-1', ['sk-sim-A']]])
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: `first ${redacted} second ${redacted}`,
      }
      const restored = restoreRevealedSimKeysForMessage(msg, cache)
      expect(restored.content).toBe(`first ${credential('sk-sim-A')} second ${redacted}`)
    })

    it('returns the same message reference when nothing to restore', () => {
      const cache = new Map<string, string[]>()
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'no credentials here',
      }
      expect(restoreRevealedSimKeysForMessage(msg, cache)).toBe(msg)
    })

    it('does nothing for user messages', () => {
      const cache = new Map<string, string[]>([['msg-1', ['sk-sim-A']]])
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: redacted,
      }
      expect(restoreRevealedSimKeysForMessage(msg, cache)).toBe(msg)
    })

    it('threads the cursor across separate content blocks so each block gets its matching key', () => {
      const cache = new Map<string, string[]>([['msg-1', ['sk-sim-A', 'sk-sim-B']]])
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: `first ${redacted} (tool ran) second ${redacted}`,
        contentBlocks: [
          { type: 'text', content: `first ${redacted}` },
          { type: 'tool_call', content: '' },
          { type: 'text', content: `second ${redacted}` },
        ],
      }
      const restored = restoreRevealedSimKeysForMessage(msg, cache)
      expect(restored.contentBlocks?.[0].content).toContain('"sk-sim-A"')
      expect(restored.contentBlocks?.[0].content).not.toContain('"sk-sim-B"')
      expect(restored.contentBlocks?.[2].content).toContain('"sk-sim-B"')
      expect(restored.contentBlocks?.[2].content).not.toContain('"sk-sim-A"')
    })

    it('isolates revealed values by message id (multiple keys across messages)', () => {
      const cache = new Map<string, string[]>([
        ['msg-1', ['sk-sim-A']],
        ['msg-2', ['sk-sim-B']],
      ])
      const msg1: ChatMessage = { id: 'msg-1', role: 'assistant', content: redacted }
      const msg2: ChatMessage = { id: 'msg-2', role: 'assistant', content: redacted }
      expect(restoreRevealedSimKeysForMessage(msg1, cache).content).toContain('sk-sim-A')
      expect(restoreRevealedSimKeysForMessage(msg2, cache).content).toContain('sk-sim-B')
      expect(restoreRevealedSimKeysForMessage(msg1, cache).content).not.toContain('sk-sim-B')
    })
  })
})
