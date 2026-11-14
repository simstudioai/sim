import { describe, expect, it, vi } from 'vitest'
import { notionCreateCommentTool } from '@/tools/notion/create_comment'
import { notionCreatePageTool, notionCreatePageV2Tool } from '@/tools/notion/create_page'
import { notionReadTool, notionReadV2Tool } from '@/tools/notion/read'
import { notionUpdatePageTool, notionUpdatePageV2Tool } from '@/tools/notion/update_page'
import { notionWriteTool } from '@/tools/notion/write'

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected the tool to define this handler')
  return value
}

const PAGE_TITLE = 'Project Apollo'

function pageResponse(): Response {
  return Response.json({
    id: 'page-1',
    url: 'https://www.notion.so/page-1',
    created_time: '2026-08-01T00:00:00.000Z',
    last_edited_time: '2026-08-02T00:00:00.000Z',
    properties: {
      Project: {
        id: 'title',
        type: 'title',
        title: [{ plain_text: PAGE_TITLE }],
      },
    },
  })
}

const responseCases = [
  {
    id: notionReadTool.id,
    title: async () =>
      (await notionReadTool.transformResponse!(pageResponse())).output.metadata.title,
  },
  {
    id: notionReadV2Tool.id,
    title: async () => (await notionReadV2Tool.transformResponse!(pageResponse())).output.title,
  },
  {
    id: notionCreatePageTool.id,
    title: async () =>
      (await notionCreatePageTool.transformResponse!(pageResponse())).output.metadata.title,
  },
  {
    id: notionCreatePageV2Tool.id,
    title: async () =>
      (await notionCreatePageV2Tool.transformResponse!(pageResponse())).output.title,
  },
  {
    id: notionUpdatePageTool.id,
    title: async () =>
      (await notionUpdatePageTool.transformResponse!(pageResponse())).output.metadata.title,
  },
  {
    id: notionUpdatePageV2Tool.id,
    title: async () =>
      (await notionUpdatePageV2Tool.transformResponse!(pageResponse())).output.title,
  },
]

describe('Notion page title responses', () => {
  it.each(responseCases)('$id reads a custom-named title property', async ({ title }) => {
    await expect(title()).resolves.toBe(PAGE_TITLE)
  })
})

type RichTextBody = { rich_text: Array<{ text: { content: string } }> }

function paragraphRichText(body: unknown): RichTextBody['rich_text'] {
  const { children } = body as { children: Array<{ paragraph: RichTextBody }> }
  return children[0].paragraph.rich_text
}

describe('Notion rich text length limit', () => {
  const longText = `${'a'.repeat(1999)}😀${'b'.repeat(2500)}`
  const bodies = [
    {
      id: notionWriteTool.id,
      richText: () =>
        paragraphRichText(
          defined(notionWriteTool.request.body)({
            accessToken: 't',
            pageId: 'p',
            content: longText,
          })
        ),
    },
    {
      id: notionCreatePageTool.id,
      richText: () =>
        paragraphRichText(
          defined(notionCreatePageTool.request.body)({
            accessToken: 't',
            parentId: 'p',
            content: longText,
          })
        ),
    },
    {
      id: notionCreateCommentTool.id,
      richText: () =>
        (
          defined(notionCreateCommentTool.request.body)({
            accessToken: 't',
            pageId: 'p',
            content: longText,
          }) as RichTextBody
        ).rich_text,
    },
  ]

  it.each(bodies)('$id splits content into 2000-character text objects', ({ richText }) => {
    const parts = richText()
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.text.content.length).toBeLessThanOrEqual(2000)
    expect(parts.map((part) => part.text.content).join('')).toBe(longText)
  })
})

describe('Notion read page content pagination', () => {
  it('follows next_cursor past the first 100 blocks', async () => {
    const paragraph = (text: string) => ({
      type: 'paragraph',
      paragraph: { rich_text: [{ plain_text: text }] },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ results: [paragraph('first')], has_more: true, next_cursor: 'cursor-2' })
      )
      .mockResolvedValueOnce(
        Response.json({ results: [paragraph('second')], has_more: false, next_cursor: null })
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await defined(notionReadV2Tool.transformResponse)(pageResponse(), {
      accessToken: 't',
      pageId: 'page-1',
    })

    expect(result.output.content).toBe('first\n\nsecond')
    expect(String(fetchMock.mock.calls[1][0])).toContain('start_cursor=cursor-2')
  })
})
