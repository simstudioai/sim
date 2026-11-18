import type { ArxivGetPaperParams, ArxivGetPaperResponse } from '@/tools/arxiv/types'
import { parseArxivXML } from '@/tools/arxiv/utils'
import type { ToolConfig } from '@/tools/types'

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
      const paperId = params.paperId
        .trim()
        .replace(/^.*arxiv\.org\/(?:abs|pdf)\//, '')
        .replace(/\.pdf$/, '')

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
      optional: true,
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
