/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { createPublishTransform, INSTAGRAM_RESPONSE_MAX_BYTES } from '@/tools/instagram/utils'

const FALLBACK_OUTPUT = {
  containerId: null,
  mediaId: null,
  statusCode: null,
}

const SUCCESS_OUTPUT = {
  containerId: 'container-1',
  mediaId: 'media-1',
  statusCode: 'FINISHED',
}

describe('createPublishTransform', () => {
  const transform = createPublishTransform('Failed to publish media')

  it('returns a validated successful publish response', async () => {
    const result = await transform(
      Response.json({
        success: true,
        output: SUCCESS_OUTPUT,
      })
    )

    expect(result).toEqual({ success: true, output: SUCCESS_OUTPUT })
  })

  it('preserves a structured failure from the publish route', async () => {
    const result = await transform(
      Response.json(
        {
          success: false,
          error: 'Container processing failed',
          output: FALLBACK_OUTPUT,
        },
        { status: 422 }
      )
    )

    expect(result).toEqual({
      success: false,
      output: FALLBACK_OUTPUT,
      error: 'Container processing failed',
    })
  })

  it('returns failure for an empty successful HTTP response', async () => {
    const result = await transform(new Response('', { status: 200 }))

    expect(result).toMatchObject({ success: false, output: FALLBACK_OUTPUT })
  })

  it('returns failure for malformed JSON in a successful HTTP response', async () => {
    const result = await transform(new Response('{not-json', { status: 200 }))

    expect(result).toMatchObject({ success: false, output: FALLBACK_OUTPUT })
  })

  it.each([
    { name: 'a missing success discriminator', body: { output: SUCCESS_OUTPUT } },
    { name: 'a missing output', body: { success: true } },
    {
      name: 'null identifiers',
      body: { success: true, output: FALLBACK_OUTPUT },
    },
    {
      name: 'an incomplete output',
      body: {
        success: true,
        output: { containerId: 'container-1', mediaId: 'media-1' },
      },
    },
  ])('returns failure for $name', async ({ body }) => {
    const result = await transform(Response.json(body))

    expect(result).toEqual({
      success: false,
      output: FALLBACK_OUTPUT,
      error: 'Failed to publish media: invalid success response',
    })
  })

  it('returns failure when the bounded response reader rejects an oversized body', async () => {
    const result = await transform(
      new Response('x'.repeat(INSTAGRAM_RESPONSE_MAX_BYTES + 1), { status: 200 })
    )

    expect(result).toMatchObject({ success: false, output: FALLBACK_OUTPUT })
    expect(result.error).toContain(
      `Instagram publish response exceeds maximum size of ${INSTAGRAM_RESPONSE_MAX_BYTES} bytes`
    )
  })

  it('returns failure when the response stream cannot be read', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('response stream failed'))
      },
    })

    const result = await transform(new Response(body, { status: 200 }))

    expect(result).toEqual({
      success: false,
      output: FALLBACK_OUTPUT,
      error: 'response stream failed',
    })
  })
})
