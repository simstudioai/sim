import { FILE_SEARCH_DEFAULT_MAX_RESULTS } from '@/lib/workspace-files/search/constants'
import type { FileSearchOutput } from '@/tools/file/types'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

interface FileSearchParams {
  query: string
  maxResults?: number
}

interface FileSearchResponse extends ToolResponse {
  output: FileSearchOutput
}

export const fileSearchTool: InternalToolConfig<FileSearchParams, FileSearchResponse> = {
  id: 'file_search',
  name: 'File Search',
  description:
    'Search indexed text across active workspace files using literal smart-case substring matching.',
  version: '1.0.0',
  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Literal text to find (3-512 characters). Uppercase Unicode letters make matching case-sensitive.',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Hard result cap configured by the workflow builder (1-200, default 50).',
    },
  },
  operation: {
    secretProvenance: { response: { incomplete: 'reject' } },
    input: (params) => ({
      query: params.query,
      maxResults: params.maxResults ?? FILE_SEARCH_DEFAULT_MAX_RESULTS,
    }),
  },
  transformResponse: async (response): Promise<FileSearchResponse> => {
    const body = await response.json()
    if (!response.ok || !body.success) {
      return {
        success: false,
        output: {
          results: [],
          count: 0,
          truncated: false,
          complete: false,
          indexStatus: {
            readyFiles: 0,
            pendingFiles: 0,
            failedFiles: 0,
            skippedFiles: 0,
            partialFiles: 0,
          },
        },
        error: body.error || 'Failed to search workspace files',
      }
    }
    return { success: true, output: body.data }
  },
  outputs: {
    results: {
      type: 'array',
      description: 'Matching logical lines with their workspace file ID and 1-based line number.',
      items: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: 'Canonical workspace file ID.' },
          lineNumber: { type: 'number', description: '1-based logical line number.' },
          text: { type: 'string', description: 'Matching line or bounded match-centered preview.' },
        },
      },
    },
    count: { type: 'number', description: 'Number of returned matching lines.' },
    truncated: {
      type: 'boolean',
      description: 'Whether more matching lines exist beyond the configured hard cap.',
    },
    complete: {
      type: 'boolean',
      description:
        'Whether indexing has no pending or failed current revisions; skipped and partial coverage is reported separately.',
    },
    indexStatus: {
      type: 'object',
      description: 'Current workspace search-index coverage by file status.',
      properties: {
        readyFiles: { type: 'number', description: 'Files whose current revision is searchable.' },
        pendingFiles: { type: 'number', description: 'Files still waiting to be indexed.' },
        failedFiles: {
          type: 'number',
          description: 'Files whose current indexing attempt failed.',
        },
        skippedFiles: {
          type: 'number',
          description: 'Files intentionally excluded because they are unsupported or oversized.',
        },
        partialFiles: {
          type: 'number',
          description: 'Searchable files whose extracted text was truncated by the parser or cap.',
        },
      },
    },
  },
}
