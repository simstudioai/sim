/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { notionCreatePageTool, notionCreatePageV2Tool } from '@/tools/notion/create_page'
import { notionReadTool, notionReadV2Tool } from '@/tools/notion/read'
import { notionUpdatePageTool, notionUpdatePageV2Tool } from '@/tools/notion/update_page'

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
