/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ErrorExtractorId, extractErrorMessage } from '@/tools/error-extractors'

const ES_EXTRACTOR = 'elasticsearch-errors'

/**
 * The `error` envelope Elasticsearch returns on a 4xx. `root_cause` repeats the
 * top-level `type`/`reason`, so the whole blob is redundant as well as noisy.
 */
const INDEX_NOT_FOUND = {
  error: {
    root_cause: [
      {
        type: 'index_not_found_exception',
        reason: 'no such index [nope]',
        'resource.type': 'index_or_alias',
        'resource.id': 'nope',
        index_uuid: '_na_',
        index: 'nope',
      },
    ],
    type: 'index_not_found_exception',
    reason: 'no such index [nope]',
    'resource.type': 'index_or_alias',
    'resource.id': 'nope',
    index_uuid: '_na_',
    index: 'nope',
  },
  status: 404,
}

/**
 * The 401 body carries the `WWW-Authenticate` challenge inside `error.header`.
 * Stringifying the envelope put that header in the user-visible error message.
 */
const SECURITY_EXCEPTION = {
  error: {
    root_cause: [
      {
        type: 'security_exception',
        reason: 'missing authentication credentials for REST request [/products/_search]',
        header: {
          'WWW-Authenticate': ['Basic realm="security" charset="UTF-8"', 'ApiKey'],
        },
      },
    ],
    type: 'security_exception',
    reason: 'missing authentication credentials for REST request [/products/_search]',
    header: {
      'WWW-Authenticate': ['Basic realm="security" charset="UTF-8"', 'ApiKey'],
    },
  },
  status: 401,
}

const PARSING_EXCEPTION = {
  error: {
    root_cause: [
      {
        type: 'parsing_exception',
        reason: '[match] query malformed, no start_object after query name',
        line: 1,
        col: 30,
      },
    ],
    type: 'parsing_exception',
    reason: '[match] query malformed, no start_object after query name',
    line: 1,
    col: 30,
  },
  status: 400,
}

/** `GET /<index>/_doc/<id>` answers 404 with `found: false` and no `error` key. */
const MISSING_DOCUMENT = { _index: 'products', _id: 'nope', found: false }

/** `DELETE /<index>/_doc/<id>` answers 404 with `result: "not_found"` and no `error` key. */
const DELETED_DOCUMENT_NOT_FOUND = {
  _index: 'products',
  _id: 'nope',
  _version: 1,
  result: 'not_found',
  _shards: { total: 2, successful: 1, failed: 0 },
}

function extract(status: number, statusText: string, data: unknown): string {
  return extractErrorMessage({ status, statusText, data }, ES_EXTRACTOR)
}

describe('elasticsearch error extractor', () => {
  it('is registered under a stable id exposed on ErrorExtractorId', () => {
    expect(ErrorExtractorId.ELASTICSEARCH_ERRORS).toBe(ES_EXTRACTOR)
  })

  it('surfaces the reason and type instead of the whole root_cause blob', () => {
    const message = extract(404, 'Not Found', INDEX_NOT_FOUND)

    expect(message).toBe('index_not_found_exception: no such index [nope]')
    expect(message).not.toContain('root_cause')
    expect(message).not.toContain('index_uuid')
  })

  it('never leaks the WWW-Authenticate challenge from a 401 body', () => {
    const message = extract(401, 'Unauthorized', SECURITY_EXCEPTION)

    expect(message).toBe(
      'security_exception: missing authentication credentials for REST request [/products/_search]'
    )
    expect(message).not.toContain('WWW-Authenticate')
    expect(message).not.toContain('realm')
    expect(message).not.toContain('ApiKey')
  })

  it('names the malformed query on a 400 rather than dumping the envelope', () => {
    expect(extract(400, 'Bad Request', PARSING_EXCEPTION)).toBe(
      'parsing_exception: [match] query malformed, no start_object after query name'
    )
  })

  it('replaces the bare "Not Found" for a missing document with a named message', () => {
    expect(extract(404, 'Not Found', MISSING_DOCUMENT)).toBe(
      'Document "nope" was not found in index "products"'
    )
  })

  it('gives a delete of a missing document the same named message', () => {
    expect(extract(404, 'Not Found', DELETED_DOCUMENT_NOT_FOUND)).toBe(
      'Document "nope" was not found in index "products"'
    )
  })

  /**
   * The missing-document bodies carry no `error` key, so that branch has to run
   * first *inside* this extractor. Pinning it here keeps the ordering a property
   * of the extractor rather than of its position in the shared array.
   */
  it('resolves a missing document even though the branch order is internal', () => {
    const bothShapes = { ...MISSING_DOCUMENT, error: { type: 'x', reason: 'should not win' } }

    expect(extract(404, 'Not Found', bothShapes)).toBe(
      'Document "nope" was not found in index "products"'
    )
  })

  it('does not repeat the type when the reason already names it', () => {
    expect(
      extract(400, 'Bad Request', {
        error: {
          type: 'illegal_argument_exception',
          reason: 'illegal_argument_exception occurred',
        },
      })
    ).toBe('illegal_argument_exception occurred')
  })

  it('falls back to the status when the body is not an Elasticsearch envelope', () => {
    expect(extract(502, 'Bad Gateway', '<html>gateway</html>')).toBe(
      'Request failed with status 502'
    )
    expect(extract(500, 'Internal Server Error', null)).toBe('Request failed with status 500')
  })
})

/**
 * The shared `ERROR_EXTRACTORS` array doubles as an ordered fallback chain for
 * every tool that names no extractor. Adding an entry can therefore change how
 * an unrelated integration's error resolves. These pin the two ways that could
 * happen: the explicit-id path for siblings, and the fallback path for a body
 * that structurally resembles an Elasticsearch envelope.
 */
describe('adding the elasticsearch extractor leaves siblings untouched', () => {
  it('resolves each sibling identically through its own id', () => {
    expect(
      extractErrorMessage(
        {
          status: 400,
          data: {
            type: 'error',
            error: { message: 'Bad request', detail: 'branch "main" is protected' },
          },
        },
        ErrorExtractorId.BITBUCKET_ERRORS
      )
    ).toBe('Bad request: branch "main" is protected')

    expect(
      extractErrorMessage(
        {
          status: 400,
          data: {
            error: {
              code: 400,
              message: 'Constraint violated',
              constraintViolations: [{ path: 'metricSelector', message: 'unknown metric' }],
            },
          },
        },
        ErrorExtractorId.DYNATRACE_ERRORS
      )
    ).toBe('Constraint violated (metricSelector: unknown metric)')

    expect(
      extractErrorMessage(
        { status: 403, data: { message: 'Quota exceeded' } },
        ErrorExtractorId.HARMONIC_ERRORS
      )
    ).toBe('Quota exceeded')

    expect(
      extractErrorMessage(
        {
          status: 400,
          data: {
            messages: [
              { type: 'ERROR', text: 'Search job failed' },
              { type: 'INFO', text: 'chatter' },
            ],
          },
        },
        ErrorExtractorId.SPLUNK_ERRORS
      )
    ).toBe('Search job failed')

    expect(
      extractErrorMessage(
        { status: 400, data: { detail: 'Invalid cohort', attr: 'cohort_id' } },
        ErrorExtractorId.POSTHOG_ERRORS
      )
    ).toBe('Invalid cohort (cohort_id)')
  })

  /**
   * The generic `nested-error-object` extractor claims *any* `data.error`
   * object. An Elasticsearch entry placed ahead of it in the array would
   * intercept Airtable and Google bodies, whose `error.type` is not a message.
   */
  it('leaves the generic nested-error-object fallback winning for an Airtable body', () => {
    expect(
      extractErrorMessage({
        status: 422,
        statusText: 'Unprocessable Entity',
        data: {
          error: {
            type: 'INVALID_REQUEST_UNKNOWN',
            message: 'Invalid request: parameter validation failed',
          },
        },
      })
    ).toBe('Invalid request: parameter validation failed')
  })

  /**
   * Pins the *actual* pre-existing resolution, not the ideal one: `bitbucket-errors`
   * sits after the generic `nested-error-object` in the array, so a Bitbucket body
   * reaching the fallback chain already resolves to the bare `error.message` and
   * loses `detail`. That quirk predates the Elasticsearch entry — it is recorded
   * here so this test proves the entry changed nothing, rather than silently
   * encoding a fix that never happened.
   */
  it('leaves a bitbucket body resolving through the fallback chain unchanged', () => {
    expect(
      extractErrorMessage({
        status: 400,
        statusText: 'Bad Request',
        data: {
          type: 'error',
          error: { message: 'Bad request', detail: 'branch "main" is protected' },
        },
      })
    ).toBe('Bad request')
  })

  it('leaves a harmonic body resolving through the fallback chain unchanged', () => {
    expect(
      extractErrorMessage({
        status: 403,
        statusText: 'Forbidden',
        data: { message: 'Quota exceeded' },
      })
    ).toBe('Quota exceeded')
  })

  it('leaves a plain-text and a status-text fallback unchanged', () => {
    expect(
      extractErrorMessage({
        status: 500,
        statusText: 'Internal Server Error',
        data: 'upstream exploded',
      })
    ).toBe('upstream exploded')
    expect(extractErrorMessage({ status: 503, statusText: 'Service Unavailable', data: {} })).toBe(
      'Service Unavailable'
    )
  })
})

/**
 * Every Elasticsearch tool must name the extractor explicitly. A tool that omits
 * it falls back to the ordered chain, where the generic `nested-error-object`
 * entry claims any `data.error` object first and stringifies the envelope.
 */
describe('every elasticsearch tool names the extractor', () => {
  it('declares it on all thirteen tools', async () => {
    const barrel = (await import('@/tools/elasticsearch/index')) as Record<
      string,
      { id?: string; errorExtractor?: string }
    >
    const tools = Object.values(barrel).filter((tool) => typeof tool?.id === 'string')

    expect(tools).toHaveLength(13)
    for (const tool of tools) {
      expect(tool.errorExtractor, `${tool.id} is missing errorExtractor`).toBe(ES_EXTRACTOR)
    }
  })
})
