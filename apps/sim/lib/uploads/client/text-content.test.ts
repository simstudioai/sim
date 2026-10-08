import { describe, expect, it } from 'vitest'
import {
  MAX_TEXT_PREVIEW_BYTES,
  readFileText,
  TEXT_PREVIEW_SIZE_MESSAGE,
} from '@/lib/uploads/client/text-content'

describe('bounded file text decoding', () => {
  it('preserves Unicode split between network chunks and original line endings', async () => {
    const bytes = new TextEncoder().encode('Café 你好\r\nKEY=value\n')
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
          controller.close()
        },
      })
    )
    await expect(readFileText(response)).resolves.toBe('Café 你好\r\nKEY=value\n')
  })

  it('cancels an oversized response before pulling any body bytes', async () => {
    let pulled = false
    let cancelled = false
    const response = new Response(
      new ReadableStream(
        {
          pull(controller) {
            pulled = true
            controller.enqueue(Uint8Array.of(65))
            controller.close()
          },
          cancel() {
            cancelled = true
          },
        },
        { highWaterMark: 0 }
      ),
      { headers: { 'content-length': String(MAX_TEXT_PREVIEW_BYTES + 1) } }
    )
    await expect(readFileText(response)).rejects.toThrow(TEXT_PREVIEW_SIZE_MESSAGE)
    expect(pulled).toBe(false)
    expect(cancelled).toBe(true)
  })

  it.each([undefined, '1'])(
    'bounds a stream with content-length %s and releases it',
    async (length) => {
      let chunks = 0
      let cancelled = false
      const response = new Response(
        new ReadableStream(
          {
            pull(controller) {
              chunks += 1
              controller.enqueue(new Uint8Array(MAX_TEXT_PREVIEW_BYTES / 5).fill(65))
              if (chunks === 8) controller.close()
            },
            cancel() {
              cancelled = true
            },
          },
          { highWaterMark: 0 }
        ),
        { headers: length ? { 'content-length': length } : {} }
      )
      await expect(readFileText(response)).rejects.toThrow(TEXT_PREVIEW_SIZE_MESSAGE)
      expect(chunks).toBe(6)
      expect(cancelled).toBe(true)
      expect(response.body?.locked).toBe(false)
    }
  )

  it('accepts the exact limit and empty responses', async () => {
    await expect(
      readFileText(new Response('a'.repeat(MAX_TEXT_PREVIEW_BYTES)))
    ).resolves.toHaveLength(MAX_TEXT_PREVIEW_BYTES)
    await expect(readFileText(new Response(null))).resolves.toBe('')
  })
})
