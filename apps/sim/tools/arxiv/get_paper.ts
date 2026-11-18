import type { ArxivGetPaperParams, ArxivGetPaperResponse } from '@/tools/arxiv/types'
import { parseArxivXML } from '@/tools/arxiv/utils'
import type { ToolConfig } from '@/tools/types'

/** A scheme-less link on arxiv.org or one of its subdomains, such as `www.arxiv.org/abs/<id>`. */
const SCHEMELESS_ARXIV_LINK = /^(?:[a-z0-9-]+\.)*arxiv\.org\//i

/**
 * The paper ID from a bare ID or an arxiv.org `/abs/` or `/pdf/` link. Only a link whose host is
 * arxiv.org or a subdomain of it is unwrapped; any other input is taken as a bare ID.
 */
function arxivPaperId(input: string): string {
  const trimmed = input.trim()
  const linkPath = arxivLinkPath(
    SCHEMELESS_ARXIV_LINK.test(trimmed) ? `https://${trimmed}` : trimmed
  )
  const id = linkPath ?? trimmed.split(/[?#]/, 1)[0]
  return id.replace(/\.pdf$/, '')
}

/** The ID after `/abs/` or `/pdf/` when `candidate` is an http(s) arxiv.org link. */
function arxivLinkPath(candidate: string): string | undefined {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  const host = url.hostname.toLowerCase()
  if (host !== 'arxiv.org' && !host.endsWith('.arxiv.org')) return undefined
  return /^\/(?:abs|pdf)\/(.+)$/.exec(url.pathname)?.[1]
}

export const getPaperTool: ToolConfig<ArxivGetPaperParams, ArxivGetPaperResponse> = {
  id: 'arxiv_get_paper',
  name: 'ArXiv Get Paper',
  description: 'Get detailed information about a specific ArXiv paper by its ID.',
  version: '1.0.0',

  params: {
    paperId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ArXiv paper ID (e.g., "1706.03762")',
    },
  },

  request: {
    url: (params: ArxivGetPaperParams) => {
      const paperId = arxivPaperId(params.paperId)
      const baseUrl = 'https://export.arxiv.org/api/query'
      const searchParams = new URLSearchParams()
      searchParams.append('id_list', paperId)

      return `${baseUrl}?${searchParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/xml',
    }),
  },

  transformResponse: async (response: Response) => {
    const xmlText = await response.text()
    const papers = parseArxivXML(xmlText)

    return {
      success: true,
      output: {
        paper: papers[0] || null,
      },
    }
  },

  outputs: {
    paper: {
      type: 'object',
      description: 'Detailed information about the requested ArXiv paper',
      nullable: true,
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        authors: { type: 'array', items: { type: 'string' } },
        published: { type: 'string' },
        updated: { type: 'string' },
        link: { type: 'string' },
        pdfLink: { type: 'string' },
        categories: { type: 'array', items: { type: 'string' } },
        primaryCategory: { type: 'string' },
        comment: { type: 'string', optional: true },
        journalRef: { type: 'string', optional: true },
        doi: { type: 'string', optional: true },
      },
    },
  },
}
