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
      description: 'ArXiv paper ID (e.g., "1706.03762", "cs.AI/0001001")',
    },
  },

  request: {
    url: (params: ArxivGetPaperParams) => {
      // Clean paper ID - remove arxiv.org URLs if present
      let paperId = params.paperId
      if (paperId.includes('arxiv.org/abs/')) {
        paperId = paperId.split('arxiv.org/abs/')[1]
      }

      const baseUrl = 'http://export.arxiv.org/api/query'
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
    if (!response.ok) {
      throw new Error(`ArXiv API error: ${response.status} ${response.statusText}`)
    }

    const xmlText = await response.text()

    // Parse XML response
    const papers = parseArxivXML(xmlText)

    if (papers.length === 0) {
      throw new Error('Paper not found')
    }

    return {
      success: true,
      output: {
        paper: papers[0],
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error
      ? error.message
      : 'An error occurred while retrieving the ArXiv paper'
  },
}
