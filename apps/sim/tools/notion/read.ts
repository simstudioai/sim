import { isRecordLike } from '@sim/utils/object'
import type { NotionReadParams, NotionResponse } from '@/tools/notion/types'
import { PAGE_OUTPUT_PROPERTIES } from '@/tools/notion/types'
import { extractTitle } from '@/tools/notion/utils'
import type { ToolConfig, ToolResponseContext } from '@/tools/types'

/** Children pages fetched per read: 10 pages of 100 top-level blocks. */
const MAX_BLOCK_CHILDREN_PAGES = 10

/**
 * Fetch a page's top-level blocks, following `has_more`/`next_cursor` up to
 * {@link MAX_BLOCK_CHILDREN_PAGES} pages. Returns null when the first page fails;
 * a later failure keeps the blocks already read.
 */
async function fetchPageBlocks(
  pageId: string,
  accessToken: string,
  signal?: AbortSignal
): Promise<unknown[] | null> {
  const blocks: unknown[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_BLOCK_CHILDREN_PAGES; page++) {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`)
    url.searchParams.set('page_size', '100')
    if (cursor) url.searchParams.set('start_cursor', cursor)

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      signal,
    })
    if (!response.ok) return page === 0 ? null : blocks

    const data = await response.json()
    blocks.push(...(data.results ?? []))
    if (!data.has_more || !data.next_cursor) break
    cursor = data.next_cursor
  }
  return blocks
}

const MARKDOWN_PREFIX: Record<string, string> = {
  paragraph: '',
  heading_1: '# ',
  heading_2: '## ',
  heading_3: '### ',
  bulleted_list_item: '• ',
  numbered_list_item: '1. ',
}

/** Render supported top-level block types as markdown; other types are skipped. */
function blocksToMarkdown(blocks: unknown[]): string {
  return blocks
    .map((block) => {
      if (!isRecordLike(block) || typeof block.type !== 'string') return ''
      const value = block[block.type]
      if (!isRecordLike(value) || !Array.isArray(value.rich_text)) return ''
      const text = value.rich_text
        .map((item: unknown) => (isRecordLike(item) ? String(item.plain_text ?? '') : ''))
        .join('')
      if (block.type === 'to_do') return `${value.checked ? '[x]' : '[ ]'} ${text}`
      const prefix = MARKDOWN_PREFIX[block.type]
      return prefix === undefined ? '' : `${prefix}${text}`
    })
    .filter(Boolean)
    .join('\n\n')
}

export const notionReadTool: ToolConfig<NotionReadParams, NotionResponse> = {
  id: 'notion_read',
  name: 'Notion Reader',
  description: 'Read content from a Notion page',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'notion',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Notion OAuth access token',
    },
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the Notion page to read',
    },
  },

  request: {
    url: (params: NotionReadParams) => {
      return `https://api.notion.com/v1/pages/${params.pageId.trim()}`
    },
    method: 'GET',
    headers: (params: NotionReadParams) => {
      // Validate access token
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }

      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      }
    },
  },

  transformResponse: async (
    response: Response,
    params?: NotionReadParams,
    context?: ToolResponseContext
  ) => {
    const data = await response.json()
    const pageTitle = extractTitle(data.properties ?? {}) || 'Untitled'

    // Now fetch the page content using blocks endpoint
    const pageId = params?.pageId?.trim()
    const accessToken = params?.accessToken

    if (!pageId || !accessToken) {
      return {
        success: true,
        output: {
          content: '',
          metadata: {
            title: pageTitle,
            lastEditedTime: data.last_edited_time,
            createdTime: data.created_time,
            url: data.url,
          },
        },
      }
    }

    const blocks = await fetchPageBlocks(pageId, accessToken, context?.signal)
    if (!blocks) {
      // If we can't get blocks, still return the page metadata
      return {
        success: true,
        output: {
          content: '',
          metadata: {
            title: pageTitle,
            lastEditedTime: data.last_edited_time,
            createdTime: data.created_time,
            url: data.url,
          },
        },
      }
    }

    const content = blocksToMarkdown(blocks)

    return {
      success: true,
      output: {
        content: content,
        metadata: {
          title: pageTitle,
          lastEditedTime: data.last_edited_time,
          createdTime: data.created_time,
          url: data.url,
        },
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Page content in markdown format with headers, paragraphs, lists, and todos',
    },
    metadata: {
      type: 'object',
      description: 'Page metadata including title, URL, and timestamps',
      properties: {
        title: { type: 'string', description: 'Page title' },
        lastEditedTime: { type: 'string', description: 'ISO 8601 last edit timestamp' },
        createdTime: { type: 'string', description: 'ISO 8601 creation timestamp' },
        url: { type: 'string', description: 'Notion page URL' },
      },
    },
  },
}

// V2 Tool with API-aligned outputs
interface NotionReadV2Response {
  success: boolean
  output: {
    content: string
    title: string
    url: string
    created_time: string
    last_edited_time: string
  }
}

export const notionReadV2Tool: ToolConfig<NotionReadParams, NotionReadV2Response> = {
  id: 'notion_read_v2',
  name: 'Notion Reader',
  description: 'Read content from a Notion page',
  version: '2.0.0',
  oauth: notionReadTool.oauth,
  params: notionReadTool.params,
  request: notionReadTool.request,

  transformResponse: async (
    response: Response,
    params?: NotionReadParams,
    context?: ToolResponseContext
  ) => {
    const data = await response.json()
    const pageTitle = extractTitle(data.properties ?? {}) || 'Untitled'

    const pageId = params?.pageId?.trim()
    const accessToken = params?.accessToken

    if (!pageId || !accessToken) {
      return {
        success: true,
        output: {
          content: '',
          title: pageTitle,
          url: data.url,
          created_time: data.created_time,
          last_edited_time: data.last_edited_time,
        },
      }
    }

    const blocks = await fetchPageBlocks(pageId, accessToken, context?.signal)
    if (!blocks) {
      return {
        success: true,
        output: {
          content: '',
          title: pageTitle,
          url: data.url,
          created_time: data.created_time,
          last_edited_time: data.last_edited_time,
        },
      }
    }

    const content = blocksToMarkdown(blocks)

    return {
      success: true,
      output: {
        content,
        title: pageTitle,
        url: data.url,
        created_time: data.created_time,
        last_edited_time: data.last_edited_time,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Page content in markdown format' },
    title: { type: 'string', description: 'Page title' },
    url: PAGE_OUTPUT_PROPERTIES.url,
    created_time: PAGE_OUTPUT_PROPERTIES.created_time,
    last_edited_time: PAGE_OUTPUT_PROPERTIES.last_edited_time,
  },
}
