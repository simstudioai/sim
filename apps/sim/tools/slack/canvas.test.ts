/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { slackCanvasTool } from '@/tools/slack/canvas'
import { slackCreateChannelCanvasTool } from '@/tools/slack/create_channel_canvas'
import { slackDeleteCanvasTool } from '@/tools/slack/delete_canvas'
import { slackEditCanvasTool } from '@/tools/slack/edit_canvas'
import { slackGetCanvasTool } from '@/tools/slack/get_canvas'
import { slackListCanvasesTool } from '@/tools/slack/list_canvases'
import { slackLookupCanvasSectionsTool } from '@/tools/slack/lookup_canvas_sections'

const auth = { accessToken: 'test-token' }

describe('shared Slack Canvas operations', () => {
  it('preserves the create endpoint, channel tab, and returned canvas ID', async () => {
    expect(
      slackCanvasTool.request.body!({ ...auth, channel: 'C1', title: 'Notes', content: '# Notes' })
    ).toEqual({
      title: 'Notes',
      channel_id: 'C1',
      document_content: { type: 'markdown', markdown: '# Notes' },
    })
    expect(
      (await slackCanvasTool.transformResponse!(Response.json({ ok: true, canvas_id: 'F1' })))
        .output
    ).toEqual({ canvas_id: 'F1' })
    await expect(
      slackCanvasTool.transformResponse!(
        Response.json({ ok: false, error: 'canvas_creation_failed', detail: 'Invalid Markdown' })
      )
    ).rejects.toThrow('Invalid Markdown')
    await expect(slackCanvasTool.transformResponse!(Response.json({ ok: true }))).rejects.toThrow()
  })
  it('preserves channel-canvas creation and duplicate errors', async () => {
    expect(
      slackCreateChannelCanvasTool.request.body!({ ...auth, channel: ' C1 ', content: '# Hub' })
    ).toEqual({ channel_id: 'C1', document_content: { type: 'markdown', markdown: '# Hub' } })
    await expect(
      slackCreateChannelCanvasTool.transformResponse!(
        Response.json({ ok: false, error: 'channel_canvas_already_exists' })
      )
    ).rejects.toThrow('already exists')
  })
  it('supports whole-canvas replacement and targeted inserts', () => {
    expect(
      slackEditCanvasTool.request.body!({
        ...auth,
        canvasId: ' F1 ',
        operation: 'replace',
        content: 'Replacement',
      })
    ).toEqual({
      canvas_id: 'F1',
      changes: [
        { operation: 'replace', document_content: { type: 'markdown', markdown: 'Replacement' } },
      ],
    })
    expect(
      slackEditCanvasTool.request.body!({
        ...auth,
        canvasId: 'F1',
        operation: 'insert_after',
        sectionId: ' S1 ',
        content: 'Next',
      })
    ).toMatchObject({ changes: [{ operation: 'insert_after', section_id: 'S1' }] })
    expect(
      slackEditCanvasTool.request.body!({
        ...auth,
        canvasId: 'F1',
        operation: 'rename',
        title: 'New',
      })
    ).toMatchObject({
      changes: [{ operation: 'rename', title_content: { type: 'markdown', markdown: 'New' } }],
    })
  })
  it('fails before requests for incomplete edits', () => {
    for (const operation of ['insert_after', 'insert_before', 'delete'] as const) {
      expect(() =>
        slackEditCanvasTool.request.body!({ ...auth, canvasId: 'F1', operation, content: 'Test' })
      ).toThrow('Section ID')
    }
    expect(() =>
      slackEditCanvasTool.request.body!({ ...auth, canvasId: 'F1', operation: 'rename' })
    ).toThrow()
    expect(() =>
      slackEditCanvasTool.request.body!({ ...auth, canvasId: 'F1', operation: 'replace' })
    ).toThrow()
  })
  it.each(['', ' ', '\n\t'])('rejects blank replacement content %j', (content) => {
    expect(() =>
      slackEditCanvasTool.request.body!({ ...auth, canvasId: 'F1', operation: 'replace', content })
    ).toThrow('Markdown content is required')
  })
  it('preserves meaningful Markdown indentation and line breaks', () => {
    const content = '    code block\n\n'
    expect(
      slackEditCanvasTool.request.body!({ ...auth, canvasId: 'F1', operation: 'replace', content })
    ).toMatchObject({ changes: [{ document_content: { type: 'markdown', markdown: content } }] })
  })
  it('returns file metadata rather than claiming to read the document body', async () => {
    const url = slackGetCanvasTool.request.url
    expect(typeof url === 'function' ? url({ ...auth, canvasId: ' F1 ' }) : url).toBe(
      'https://slack.com/api/files.info?file=F1'
    )
    const result = await slackGetCanvasTool.transformResponse!(
      Response.json({
        ok: true,
        file: { id: 'F1', title: 'Notes', permalink: 'https://example.slack.com/docs/F1' },
      })
    )
    expect(result.output.canvas).toMatchObject({ id: 'F1', title: 'Notes' })
    expect(result.output).not.toHaveProperty('content')
  })
  it('preserves canvas paging and section lookup IDs', async () => {
    const url = slackListCanvasesTool.request.url
    expect(typeof url === 'function' ? url({ ...auth, count: 10, page: 2 }) : url).toBe(
      'https://slack.com/api/files.list?types=canvas&count=10&page=2'
    )
    expect(
      (
        await slackListCanvasesTool.transformResponse!(
          Response.json({
            ok: true,
            files: [{ id: 'F1' }],
            paging: { count: 10, total: 25, page: 2, pages: 3 },
          })
        )
      ).output.paging
    ).toEqual({ count: 10, total: 25, page: 2, pages: 3 })
    expect(
      slackLookupCanvasSectionsTool.request.body!({
        ...auth,
        canvasId: 'F1',
        criteria: '{"contains_text":"Plan"}',
      })
    ).toEqual({ canvas_id: 'F1', criteria: { contains_text: 'Plan' } })
    expect(
      (
        await slackLookupCanvasSectionsTool.transformResponse!(
          Response.json({ ok: true, sections: [{ id: 'S1' }] })
        )
      ).output.sections
    ).toEqual([{ id: 'S1' }])
  })
  it('propagates scope and access failures', async () => {
    await expect(
      slackEditCanvasTool.transformResponse!(
        Response.json({ ok: false, error: 'missing_scope', needed: 'canvases:write' })
      )
    ).rejects.toThrow('canvases:write')
    await expect(
      slackDeleteCanvasTool.transformResponse!(
        Response.json({ ok: false, error: 'canvas_not_found' })
      )
    ).rejects.toThrow('not found')
    await expect(
      slackGetCanvasTool.transformResponse!(Response.json({ ok: false, error: 'not_visible' }))
    ).rejects.toThrow('not visible')
  })
})
