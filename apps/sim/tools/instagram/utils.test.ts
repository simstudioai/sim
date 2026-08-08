/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createPublishTransform,
  INSTAGRAM_RESPONSE_MAX_BYTES,
  parseCommaSeparated,
} from '@/tools/instagram/utils'

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
})

describe('parseCommaSeparated', () => {
  it('parses nonempty comma-separated insight metrics', () => {
    expect(parseCommaSeparated(' reach, views,likes ')).toEqual(['reach', 'views', 'likes'])
  })

  it.each([{ value: undefined }, { value: '' }, { value: ' , ' }, { value: [] }])(
    'rejects invalid insight metrics: $value',
    ({ value }) => {
      expect(() => parseCommaSeparated(value)).toThrow(
        'Instagram insight metrics must be a non-empty comma-separated string'
      )
    }
  )
})
