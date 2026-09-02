import { FILE_SEARCH_DEFAULT_MAX_RESULTS } from '@/lib/workspace-files/search/constants'
import { type FileSearchMode, isFileSearchMode } from '@/lib/workspace-files/search/pattern'
import type { FileSearchOutput } from '@/tools/file/types'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

interface FileSearchParams {
  query: string
  mode?: FileSearchMode
  maxResults?: number
  folderPaths?: string[]
  includeSubfolders?: boolean
}

interface FileSearchResponse extends ToolResponse {
  output: FileSearchOutput
}

/**
 * Both modes read the same query box, so the model has to be told which one is
 * in force. It cannot see `mode` — that is a builder setting — and the two
 * readings disagree on every metacharacter, so a regex sent to a block set to
 * exact matching is searched for verbatim and silently finds nothing.
 */
const TOOL_DESCRIPTIONS: Record<FileSearchMode, string> = {
  regex:
    'Search the indexed text of active workspace files for lines matching a regular expression, and return each matching line once with its file ID and line number. Coverage is what the index currently holds: when "complete" is false the index is still catching up, so a term that is not found is unknown rather than absent. Re-check before creating something on the assumption it is missing. Narrow the search with folderPaths to confine it to one folder tree, which also narrows "indexStatus" to that tree.',
  exact:
    'Search the indexed text of active workspace files for lines containing an exact piece of text, and return each matching line once with its file ID and line number. Coverage is what the index currently holds: when "complete" is false the index is still catching up, so a term that is not found is unknown rather than absent. Re-check before creating something on the assumption it is missing. Narrow the search with folderPaths to confine it to one folder tree, which also narrows "indexStatus" to that tree.',
}

const QUERY_DESCRIPTIONS: Record<FileSearchMode, string> = {
  regex:
    'A regular expression matched against each line, 3-512 characters. Supports "." "*" "+" "?" "{n,m}" and their lazy forms, character classes such as "[a-z]" and "[^0-9]", the classes \\d \\w \\s and \\D \\W \\S, alternation "|", groups "(...)" and "(?:...)", the anchors "^" and "$", and the word boundary \\b. Lookahead, lookbehind, backreferences, named groups, inline flags such as "(?i)", \\p{...} and POSIX "[[:alpha:]]" classes are not supported, and a pattern cannot span a line break. The pattern must contain at least 3 consecutive literal characters that every match will include — write "error \\d+" rather than "\\w+ \\d+". Escape any metacharacter you mean literally. Matching is case-insensitive until the pattern contains an uppercase letter you are searching for; uppercase inside an escape or a character class, such as \\D or [A-Z], does not make it case-sensitive.',
  exact:
    'The exact text to find, 3-512 characters. It is matched verbatim: ".", "*", "(" and every other regular-expression metacharacter is searched for as itself, so nothing needs escaping. Matching is case-insensitive until the text contains an uppercase letter, which makes it case-sensitive.',
}

/**
 * What a consumer sees before the mode is known — the catalog, the generated
 * docs, and a block saved before Match existed. Unlike the runtime schema it is
 * never enriched with the mode in force, so it has to name both readings rather
 * than describe only the default.
 */
const DECLARED_QUERY_DESCRIPTION = `${QUERY_DESCRIPTIONS.regex} When the workflow builder sets Match to exact instead, the query is matched verbatim and no metacharacter needs escaping.`

/**
 * What a consumer sees before the mode is known — the catalog and the generated
 * docs. Like {@link DECLARED_QUERY_DESCRIPTION} it names both readings rather
 * than describing only the default, because a reader of the docs has no way to
 * tell which mode a given block is set to.
 */
const DECLARED_TOOL_DESCRIPTION =
  'Search the indexed text of active workspace files for lines matching a query, and return each matching line once with its file ID and line number. By default the query is a regular expression; in exact mode it is matched verbatim and metacharacters are literal. Coverage is what the index currently holds: when "complete" is false the index is still catching up, so a term that is not found is unknown rather than absent. Re-check before creating something on the assumption it is missing. Narrow the search with folderPaths to confine it to one folder tree, which also narrows "indexStatus" to that tree.'

export const fileSearchTool: InternalToolConfig<FileSearchParams, FileSearchResponse> = {
  id: 'file_search',
  name: 'File Search',
  description: DECLARED_TOOL_DESCRIPTION,
  version: '1.1.0',
  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: DECLARED_QUERY_DESCRIPTION,
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'How the query is read, chosen by the workflow builder: "regex" (default) as a regular expression, or "exact" as verbatim text.',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Hard result cap configured by the workflow builder (1-200, default 50).',
    },
    folderPaths: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      maxItems: 64,
      items: { type: 'string' },
      description:
        'Folders the search is confined to, as canonical percent-encoded paths, e.g. ["/memory/user-a"]. Absent searches the whole workspace. Scoping also narrows the reported index coverage, so "complete" describes the folders searched.',
    },
    includeSubfolders: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the scope descends into nested folders. Defaults to true; set false to search only the folders’ direct files.',
    },
  },
  /**
   * `mode` is withheld from the model, so the tool speaks for it: the active
   * mode's syntax replaces the declared default. Enrichment only runs once
   * `mode` is bound, and a block saved before the field existed falls through
   * to the declarations above — which describe the mode it defaults to.
   */
  toolEnrichment: {
    dependsOn: 'mode',
    enrichTool: async (mode, schema) => {
      if (!isFileSearchMode(mode)) return null
      const query = schema.properties.query as { description?: string } | undefined
      return {
        description: TOOL_DESCRIPTIONS[mode],
        parameters: query
          ? {
              ...schema,
              properties: {
                ...schema.properties,
                query: { ...query, description: QUERY_DESCRIPTIONS[mode] },
              },
            }
          : schema,
      }
    },
  },
  operation: {
    secretProvenance: { response: { incomplete: 'reject' } },
    input: (params) => ({
      query: params.query,
      mode: params.mode ?? 'regex',
      maxResults: params.maxResults ?? FILE_SEARCH_DEFAULT_MAX_RESULTS,
      /*
       * Presence, not length: an explicitly empty list is a scope naming no
       * folder, which must match nothing. Dropping it would answer a request
       * for nothing with the whole workspace.
       */
      ...(params.folderPaths === undefined ? {} : { folderPaths: params.folderPaths }),
      ...(params.includeSubfolders === false ? { includeSubfolders: false } : {}),
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
