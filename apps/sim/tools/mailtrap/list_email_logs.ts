import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  MAILTRAP_SENDING_MESSAGE_OUTPUT_PROPERTIES,
  type MailtrapListEmailLogsParams,
  type MailtrapListEmailLogsResult,
} from '@/tools/mailtrap/types'
import { mapSendingMessage, readJsonBody } from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

/** Splits a comma-separated filter value into trimmed, non-empty entries. */
function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

const SUBJECT_MATCH_OPERATORS = {
  contain: 'ci_contain',
  equal: 'ci_equal',
  empty: 'empty',
} as const

/**
 * Builds the `?search_after=…&filters[field][operator]=…&filters[field][value]=…`
 * query string. Mailtrap parses the deep-object bracket notation, so the bracket
 * characters are left intact and only the values are percent-encoded.
 *
 * The tool exposes a curated subset of the Email Logs filter set with fixed
 * operators. `to`/`from` use `ci_equal` (case-insensitive exact), `subject` is
 * driven by `subjectMatch`, and `status`/`category`/`sending_stream` use `equal`
 * and accept a comma-separated list that is sent as an array (`value[]`), so a
 * single filter can match any of several values. Negation, numeric open/click
 * counts, event, and IP/domain filters are not exposed.
 */
function buildEmailLogsQuery(params: MailtrapListEmailLogsParams): string {
  const parts: string[] = []
  const add = (key: string, value: string) => parts.push(`${key}=${encodeURIComponent(value)}`)

  /** Emits `filters[field][operator]` plus one or more `filters[field][value]` entries. */
  const addFilter = (field: string, operator: string, values: string[]) => {
    add(`filters[${field}][operator]`, operator)
    if (values.length === 1) {
      add(`filters[${field}][value]`, values[0])
    } else {
      for (const value of values) add(`filters[${field}][value][]`, value)
    }
  }

  if (params.searchAfter?.trim()) add('search_after', params.searchAfter.trim())
  if (params.sentAfter?.trim()) add('filters[sent_after]', params.sentAfter.trim())
  if (params.sentBefore?.trim()) add('filters[sent_before]', params.sentBefore.trim())
  if (params.to?.trim()) addFilter('to', 'ci_equal', [params.to.trim()])
  if (params.fromAddress?.trim()) addFilter('from', 'ci_equal', [params.fromAddress.trim()])

  const subjectMatch = params.subjectMatch?.trim() || 'contain'
  if (!Object.hasOwn(SUBJECT_MATCH_OPERATORS, subjectMatch)) {
    throw new Error(`Invalid subjectMatch "${subjectMatch}". Use "contain", "equal", or "empty".`)
  }
  const subjectOperator =
    SUBJECT_MATCH_OPERATORS[subjectMatch as keyof typeof SUBJECT_MATCH_OPERATORS]
  if (subjectOperator === 'empty') {
    // The `empty`/`not_empty` operators carry no value.
    add('filters[subject][operator]', 'empty')
  } else if (params.subject?.trim()) {
    addFilter('subject', subjectOperator, [params.subject.trim()])
  }

  const addCsvFilter = (field: string, value: string | undefined) => {
    const values = splitCsv(value ?? '')
    if (values.length > 0) addFilter(field, 'equal', values)
  }
  addCsvFilter('status', params.status)
  addCsvFilter('category', params.category)
  addCsvFilter('sending_stream', params.sendingStream)

  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export const mailtrapListEmailLogsTool: ToolConfig<
  MailtrapListEmailLogsParams,
  MailtrapListEmailLogsResult
> = {
  id: 'mailtrap_list_email_logs',
  name: 'Mailtrap List Email Logs',
  description:
    'List sent messages from the Mailtrap email logs, filtered by date range, recipient, sender, subject, status, category, or stream. Results are ordered by sent time, newest first, and paginated with a cursor. Advanced filters (negation, event, open/click counts, IP, domain) are not exposed.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.MAILTRAP_ERRORS,

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailtrap API token with access to the sending domains',
    },
    sentAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of the sent-at range, ISO 8601 (e.g. "2025-01-01T00:00:00Z")',
    },
    sentBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the sent-at range, ISO 8601',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by recipient address, case-insensitive exact match (ci_equal operator)',
    },
    fromAddress: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by sender address, case-insensitive exact match (ci_equal operator)',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by subject. The match operator is set by subjectMatch (defaults to case-insensitive substring). Ignored when subjectMatch is "empty".',
    },
    subjectMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How to match subject: "contain" (case-insensitive substring, default), "equal" (case-insensitive exact), or "empty" (messages with no subject).',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by delivery status, exact match. Accepts a comma-separated list to match any of: "delivered", "not_delivered", "enqueued", "opted_out"',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by category, exact match. Accepts a comma-separated list',
    },
    sendingStream: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by stream, exact match: "transactional" or "bulk". Accepts a comma-separated list',
    },
    searchAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor (the nextPageCursor from a previous call)',
    },
  },

  request: {
    url: (params) => `https://mailtrap.io/api/email_logs${buildEmailLogsQuery(params)}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response): Promise<MailtrapListEmailLogsResult> => {
    const data = await readJsonBody(response)
    const messages = Array.isArray(data.messages) ? data.messages.map(mapSendingMessage) : []

    return {
      success: true,
      output: {
        messages,
        totalCount: typeof data.total_count === 'number' ? data.total_count : messages.length,
        nextPageCursor: typeof data.next_page_cursor === 'string' ? data.next_page_cursor : null,
      },
    }
  },

  outputs: {
    messages: {
      type: 'array',
      description: 'Matching messages, newest first',
      items: {
        type: 'object',
        properties: MAILTRAP_SENDING_MESSAGE_OUTPUT_PROPERTIES,
      },
    },
    totalCount: {
      type: 'number',
      description: 'Total messages matching the filters, before paging',
    },
    nextPageCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null when there are no more results',
      nullable: true,
    },
  },
}
