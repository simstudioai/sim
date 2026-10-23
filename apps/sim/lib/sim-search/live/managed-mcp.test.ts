import { describe, expect, it, vi } from 'vitest'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { managedMcpPayload } from '@/lib/sim-search/live/managed-mcp-payload'

/** Failure modes: payloads exhaust memory or reflect sensitive provider errors. */
describe('managed search MCP read boundary', () => {
  it('rejects oversized and failed tool payloads without exposing provider errors', () => {
    expect(() =>
      managedMcpPayload(
        { content: [{ type: 'text', text: 'x'.repeat(4 * 1024 * 1024 + 1) }] },
        'Fireflies'
      )
    ).toThrow('size limit')
    expect(() =>
      managedMcpPayload(
        { isError: true, content: [{ type: 'text', text: 'secret token' }] },
        'Fireflies'
      )
    ).toThrow('could not complete')
  })

  it('makes a Granola OAuth account mismatch actionable without reflecting provider text', () => {
    let failure: unknown
    try {
      managedMcpPayload(
        {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Unauthorized: user has not created a Granola account yet. private-provider-detail',
            },
          ],
        },
        'Granola'
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ status: 'reconnect' })
    expect(failure).toBeInstanceOf(NativeSearchError)
    expect((failure as NativeSearchError).message).toContain('existing Granola account')
    expect((failure as NativeSearchError).message).not.toContain('private-provider-detail')
  })

  it('rejects escaped MCP payload overflow before allocating its JSON representation', () => {
    const result = { structuredContent: { ['\u0000'.repeat(800_000)]: 'value' } }
    const serialize = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
      throw new Error('Oversized payload reached serialization')
    })
    try {
      expect(() => managedMcpPayload(result, 'Fireflies')).toThrow('size limit')
      expect(serialize).not.toHaveBeenCalled()
    } finally {
      serialize.mockRestore()
    }
  })

  it.each(['wide', 'deep'] as const)(
    'preserves byte-small %s MCP responses without imposing capture limits',
    (shape) => {
      let content: unknown = shape === 'wide' ? Array.from({ length: 100_000 }, () => 0) : 'leaf'
      if (shape === 'deep') {
        for (let index = 0; index < 128; index++) content = { child: content }
      }
      const result = { structuredContent: content }
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(4 * 1024 * 1024)
      expect(managedMcpPayload(result, 'Fireflies')).toEqual(content)
    }
  )
})
