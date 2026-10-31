import {
  createMcpHandler,
  hostHeaderValidationResponse,
  McpServer,
  originValidationResponse,
} from '@modelcontextprotocol/server'
import { z } from 'zod'
import { listPages, listPagesSchema, pagePathSchema, readPage } from '@/lib/http/pages'
import { searchDocs } from '@/lib/search/service'
import { DOCS_BASE_URL } from '@/lib/urls'

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const handler = createMcpHandler(
  () => {
    const server = new McpServer(
      { name: 'sim-documentation', version: '1.0.0' },
      {
        instructions:
          'Read-only Sim documentation. Use list_pages to discover canonical paths, get_page for complete Markdown, and search for citations. This server does not access Sim workspaces.',
      }
    )
    server.registerTool(
      'list_pages',
      {
        description:
          'Discover Sim documentation with bounded pagination. Pass nextCursor as cursor for the next page.',
        inputSchema: listPagesSchema,
        annotations,
      },
      async (input) => {
        try {
          const result = listPages(input)
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
          }
        } catch {
          return {
            isError: true,
            content: [
              { type: 'text', text: 'Unknown page cursor. Start discovery without a cursor.' },
            ],
          }
        }
      }
    )
    server.registerTool(
      'get_page',
      {
        description:
          'Retrieve complete processed Markdown and metadata for a canonical documentation path, such as /introduction. No external URLs are accepted.',
        inputSchema: z.object({ path: pagePathSchema }),
        annotations,
      },
      async ({ path }) => {
        const page = readPage(path)
        if (!page)
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Page not found. Use list_pages or search to find a canonical path.',
              },
            ],
          }
        return { content: [{ type: 'text', text: page.markdown }], structuredContent: { page } }
      }
    )
    server.registerTool(
      'search',
      {
        description:
          'Search guides, integrations, API, CLI and MCP references. Results use the same canonical heading citations as the documentation site.',
        inputSchema: z.object({
          query: z.string().trim().min(1).max(256),
          limit: z.number().int().min(1).max(20).default(10),
        }),
        annotations,
      },
      async ({ query, limit }, context) => {
        const results = await searchDocs(query, limit, context.mcpReq.signal)
        return {
          content: [{ type: 'text', text: JSON.stringify(results) }],
          structuredContent: { results },
        }
      }
    )
    return server
  },
  { maxRequestBodySize: 16 * 1024, responseMode: 'json', legacy: 'stateless' }
)

/** Public catalog access permits known deployment origins and non-browser MCP clients. */
export async function handleMcpRequest(request: Request) {
  const hosts = [new URL(DOCS_BASE_URL).hostname, 'localhost', '127.0.0.1', '[::1]']
  if (process.env.VERCEL_URL) hosts.push(process.env.VERCEL_URL)
  const rejected =
    hostHeaderValidationResponse(request, hosts) ?? originValidationResponse(request, hosts)
  if (rejected) return rejected
  const response = await handler.fetch(request)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}
