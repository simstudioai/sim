import { jsonResponse } from '@sim/testing/helpers/http'
import { describe, expect, it } from 'vitest'
import {
  figmaCreateCommentTool,
  figmaDeleteCommentTool,
  figmaExportNodesTool,
  figmaGetImageFillsTool,
  figmaListCommentsTool,
  figmaListFileComponentsTool,
  figmaListFileStylesTool,
  figmaListFileVersionsTool,
} from '@/tools/figma'

const user = {
  id: '12345678901234567890',
  handle: 'Fixture',
  img_url: 'https://example.test/avatar.png',
}
const context = { accessToken: 'fixture-access', fileKey: 'fixture-file' }

async function transform(tool: typeof figmaGetImageFillsTool, response: Response) {
  if (!tool.transformResponse) throw new Error('Expected a provider response transform')
  return tool.transformResponse(response, context)
}

describe('Figma provider response contracts', () => {
  it('projects documented comment positioning when Figma adds response-only fields', async () => {
    const comment = {
      id: 'comment-1',
      file_key: 'fixture-file',
      user,
      created_at: '2026-01-01T00:00:00Z',
      message: 'Test comment',
      client_meta: { node_id: '12:34', node_offset: { x: 25, y: 25 }, stable_path: [1, 2] },
    }
    const created = await figmaCreateCommentTool.transformResponse?.(jsonResponse(comment), {
      ...context,
      message: comment.message,
    })
    const listed = await figmaListCommentsTool.transformResponse?.(
      jsonResponse({ comments: [comment] }),
      context
    )
    const position = { node_id: '12:34', node_offset: { x: 25, y: 25 } }
    expect(created?.output.comment.client_meta).toEqual(position)
    expect(listed?.output.comments[0]?.client_meta).toEqual(position)
    await expect(
      figmaCreateCommentTool.transformResponse?.(
        jsonResponse({
          ...comment,
          client_meta: { ...comment.client_meta, region_height: -1, region_width: 20 },
        }),
        { ...context, message: comment.message }
      )
    ).rejects.toThrow()
  })

  it('ignores stale SVG-only controls when requesting a PNG export', () => {
    const urlBuilder = figmaExportNodesTool.request?.url
    if (typeof urlBuilder !== 'function') throw new Error('Expected an export request URL builder')
    const url = new URL(
      urlBuilder({
        ...context,
        nodeIds: '12:34',
        format: 'png',
        svgOutlineText: 'stale-invalid-value',
      } as unknown as Parameters<typeof urlBuilder>[0])
    )
    expect(url.searchParams.get('format')).toBe('png')
    expect(url.searchParams.has('svg_outline_text')).toBe(false)
  })

  it('rejects oversized bodies before decoding provider JSON', async () => {
    const response = new Response('{}', {
      headers: { 'Content-Length': String(10 * 1024 * 1024 + 1) },
    })
    await expect(transform(figmaGetImageFillsTool, response)).rejects.toThrow(/maximum size/)
  })
  it('propagates cancellation while waiting for a response body', async () => {
    let closed = false
    const response = new Response(
      new ReadableStream({
        cancel() {
          closed = true
        },
      })
    )
    const controller = new AbortController()
    const pending = figmaGetImageFillsTool.transformResponse?.(response, context, {
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(closed).toBe(true)
  })
  it.each([
    {
      response: { err: null, status: 200, images: {} },
      output: { err: null, status: 200, images: {} },
    },
    { response: { err: null, images: {} }, output: { err: null, status: null, images: {} } },
  ])('preserves native export error/status metadata: %j', async ({ response, output }) => {
    const result = await figmaExportNodesTool.transformResponse?.(jsonResponse(response), {
      ...context,
      nodeIds: '12:34',
    })
    expect(result?.output).toEqual(output)
  })
  it('preserves published library fields and defaults absent optional fields', async () => {
    const published = {
      key: 'resource',
      file_key: 'fixture-file',
      node_id: '12:34',
      name: 'Button',
      description: '',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      user,
    }
    const components = await figmaListFileComponentsTool.transformResponse?.(
      jsonResponse({ error: false, status: 200, meta: { components: [published] } }),
      context
    )
    const styles = await figmaListFileStylesTool.transformResponse?.(
      jsonResponse({
        error: false,
        status: 200,
        meta: { styles: [{ ...published, style_type: 'FILL', sort_position: '0' }] },
      }),
      context
    )
    expect(components?.output.components[0]).toMatchObject({
      ...published,
      thumbnail_url: null,
      containing_frame: null,
    })
    expect(styles?.output.styles[0]).toMatchObject({
      style_type: 'FILL',
      sort_position: '0',
      thumbnail_url: null,
    })
  })
  it('keeps version identifiers and pagination URLs exact', async () => {
    const id = '12345678901234567890'
    const result = await figmaListFileVersionsTool.transformResponse?.(
      jsonResponse({
        versions: [
          { id, created_at: '2026-01-01T00:00:00Z', label: null, description: null, user },
        ],
        pagination: {
          next_page: `https://api.figma.com/v1/files/fixture-file/versions?before=${id}`,
        },
      }),
      context
    )
    expect(result?.output.versions[0]?.id).toBe(id)
    expect(result?.output.pagination).toEqual({
      prev_page: null,
      next_page: `https://api.figma.com/v1/files/fixture-file/versions?before=${id}`,
    })
  })
  it('accepts successful empty and JSON deletion responses', async () => {
    for (const response of [
      new Response(null, { status: 204 }),
      new Response('', { status: 200 }),
      jsonResponse({ error: false, status: 200 }),
    ]) {
      const result = await figmaDeleteCommentTool.transformResponse?.(response, {
        ...context,
        commentId: 'comment-1',
      })
      expect(result).toEqual({ success: true, output: { deleted: true } })
    }
  })
  it('rejects malformed success collections instead of silently reporting an empty result', async () => {
    await expect(
      figmaListCommentsTool.transformResponse?.(jsonResponse({ comments: 'invalid' }), context)
    ).rejects.toThrow()
    await expect(
      transform(figmaGetImageFillsTool, jsonResponse({ error: false, status: 200, images: {} }))
    ).rejects.toThrow()
  })
  it('rejects provider errors even when the HTTP status is 200', async () => {
    await expect(
      transform(
        figmaGetImageFillsTool,
        jsonResponse({
          error: true,
          status: 200,
          message: 'Permission denied',
          meta: { images: {} },
        })
      )
    ).rejects.toThrow('Permission denied')
    await expect(
      figmaExportNodesTool.transformResponse?.(jsonResponse({ err: 'Render failed', images: {} }), {
        ...context,
        nodeIds: '12:34',
      })
    ).rejects.toThrow('Render failed')
  })
})
