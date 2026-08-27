/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ErrorExtractorId, extractErrorMessage } from '@/tools/error-extractors'
import {
  splunkCancelSearchJobTool,
  splunkCreateSearchJobTool,
  splunkDispatchSavedSearchTool,
  splunkGetFiredAlertsTool,
  splunkGetSavedSearchTool,
  splunkGetSearchJobTool,
  splunkGetSearchResultsTool,
  splunkListAppsTool,
  splunkListFiredAlertsTool,
  splunkListIndexesTool,
  splunkListSavedSearchesTool,
  splunkRunSearchTool,
} from '@/tools/splunk'

/**
 * Under the `output_mode=json` every Splunk request pins, the REST error envelope
 * is `{messages: [{type, text}]}`. With no extractor for that shape the message
 * fell through to the HTTP status text, so the most common failure — a bad SPL
 * string — reported only "Bad Request".
 */
describe('splunk-errors extractor', () => {
  it('reads the ERROR message text instead of the status text', () => {
    const message = extractErrorMessage(
      {
        status: 400,
        statusText: 'Bad Request',
        data: {
          messages: [
            {
              type: 'ERROR',
              text: "Error in 'search' command: Unable to parse the search: Comparator '=' is missing a term on the right hand side.",
            },
          ],
        },
      },
      ErrorExtractorId.SPLUNK_ERRORS
    )

    expect(message).toContain("Error in 'search' command")
    expect(message).not.toBe('Bad Request')
  })

  it('prefers ERROR entries over informational ones', () => {
    const message = extractErrorMessage(
      {
        status: 400,
        statusText: 'Bad Request',
        data: {
          messages: [
            { type: 'INFO', text: 'Search context loaded.' },
            { type: 'ERROR', text: 'Unknown index "nope".' },
          ],
        },
      },
      ErrorExtractorId.SPLUNK_ERRORS
    )

    expect(message).toBe('Unknown index "nope".')
  })

  it('falls back to any message text when none is typed ERROR', () => {
    expect(
      extractErrorMessage(
        {
          status: 403,
          statusText: 'Forbidden',
          data: { messages: [{ type: 'WARN', text: 'Insufficient permissions.' }] },
        },
        ErrorExtractorId.SPLUNK_ERRORS
      )
    ).toBe('Insufficient permissions.')
  })

  it('joins multiple ERROR entries rather than dropping all but one', () => {
    expect(
      extractErrorMessage(
        {
          status: 400,
          statusText: 'Bad Request',
          data: {
            messages: [
              { type: 'ERROR', text: 'first' },
              { type: 'ERROR', text: 'second' },
            ],
          },
        },
        ErrorExtractorId.SPLUNK_ERRORS
      )
    ).toBe('first; second')
  })

  it('leaves the status fallback in place when the body carries no messages', () => {
    expect(
      extractErrorMessage(
        { status: 500, statusText: 'Internal Server Error', data: {} },
        ErrorExtractorId.SPLUNK_ERRORS
      )
    ).toBe('Request failed with status 500')
  })
})

const SPLUNK_TOOLS = [
  splunkRunSearchTool,
  splunkCreateSearchJobTool,
  splunkGetSearchJobTool,
  splunkGetSearchResultsTool,
  splunkCancelSearchJobTool,
  splunkListSavedSearchesTool,
  splunkGetSavedSearchTool,
  splunkDispatchSavedSearchTool,
  splunkListFiredAlertsTool,
  splunkGetFiredAlertsTool,
  splunkListIndexesTool,
  splunkListAppsTool,
]

describe('splunk tools declare the extractor', () => {
  it('covers all twelve tools', () => {
    expect(SPLUNK_TOOLS).toHaveLength(12)
  })

  it.each(SPLUNK_TOOLS.map((tool) => [tool.id, tool] as const))(
    '%s sets errorExtractor',
    (_id, tool) => {
      expect(tool.errorExtractor).toBe(ErrorExtractorId.SPLUNK_ERRORS)
    }
  )
})
