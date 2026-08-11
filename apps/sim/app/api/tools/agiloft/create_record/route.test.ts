/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { POST } from '@/app/api/tools/agiloft/create_record/route'
import { POST as READ } from '@/app/api/tools/agiloft/read_record/route'
import { POST as SEARCH } from '@/app/api/tools/agiloft/search_records/route'

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'Russell Investments',
  login: 'svc.user',
  password: PLACEHOLDER_PASSWORD,
  table: 'contract',
}

function res(body: { ok?: boolean; status?: number; json?: unknown; text?: string }) {
  const text = body.text ?? JSON.stringify(body.json ?? {})
  return {
    ok: body.ok ?? true,
    status: body.status ?? 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

/** Login envelope Agiloft returns — note the trailing space on the scheme. */
const LOGIN_OK = res({
  json: { access_token: 'tok-123', authentication_scheme: 'Bearer ' },
})

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: PINNED_IP,
    originalHostname: 'example.agiloft.com',
  })
})

function arrange(operationResponse: ReturnType<typeof res>) {
  inputValidationMockFns.mockSecureFetchWithPinnedIP
    .mockResolvedValueOnce(LOGIN_OK)
    .mockResolvedValueOnce(operationResponse)
    .mockResolvedValueOnce(res({}))
}

describe('EWLogin', () => {
  it('sends $table and $lang alongside $KB in a form body, which the live server requires', async () => {
    arrange(res({ json: { success: true, result: { id: 6342 } } }))

    await POST(createMockRequest('POST', { ...baseBody, data: '{"a":"b"}' }))

    const [url, ip, init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(url).toBe('https://example.agiloft.com/ewws/EWLogin')
    expect(ip).toBe(PINNED_IP)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')

    const sent = new URLSearchParams(init.body as string)
    expect(sent.get('$KB')).toBe('Russell Investments')
    expect(sent.get('$table')).toBe('contract')
    expect(sent.get('$lang')).toBe('en')
    expect(sent.get('$login')).toBe('svc.user')
    expect(sent.get('$password')).toBe(PLACEHOLDER_PASSWORD)
    // Credentials must not leak into the URL.
    expect(url).not.toContain(PLACEHOLDER_PASSWORD)
  })

  it('trims the trailing space Agiloft puts on authentication_scheme', async () => {
    arrange(res({ json: { success: true, result: { id: 6342 } } }))

    await POST(createMockRequest('POST', { ...baseBody, data: '{"a":"b"}' }))

    const [, , init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(init.headers.Authorization).toBe('Bearer tok-123')
  })

  it('surfaces the live "One has to specify" refusal instead of a generic failure', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({
        ok: false,
        status: 400,
        text: '<html><body>EWWrongDataException has occurred: One has to specify $table, $KB, $lang parameters</body></html>',
      })
    )

    const response = await POST(createMockRequest('POST', { ...baseBody, data: '{"a":"b"}' }))
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('One has to specify $table, $KB, $lang')
  })
})

describe('alrest envelope handling', () => {
  it('targets /ewws/alrest/{KB} for record creation', async () => {
    arrange(res({ json: { success: true, result: { id: 6342, contract_title1: 'X' } } }))

    const response = await POST(
      createMockRequest('POST', { ...baseBody, data: '{"contract_title1":"X"}' })
    )
    const data = (await response.json()) as { success: boolean; output: { id: string | null } }

    const [url] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(url).toBe(
      'https://example.agiloft.com/ewws/alrest/Russell%20Investments/contract?lang=en'
    )
    expect(data.output.id).toBe('6342')
  })

  it('treats HTTP 200 with success:false as a failure, not a successful create', async () => {
    arrange(
      res({
        json: { success: false, errors: [{ message: 'Field contract_title1 is required' }] },
      })
    )

    const response = await POST(createMockRequest('POST', { ...baseBody, data: '{"a":"b"}' }))
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('Field contract_title1 is required')
  })
})

describe('field projection', () => {
  it('reads through search when fields are named, so a 184KB record is not pulled whole', async () => {
    arrange(res({ json: { success: true, result: [{ id: 6342, contract_title1: 'X' }] } }))

    await READ(
      createMockRequest('POST', {
        ...baseBody,
        recordId: '6342',
        fields: 'contract_title1, company_name',
      })
    )

    const [url, , init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(url).toContain('/contract/search?lang=en')
    expect(JSON.parse(init.body as string)).toEqual({
      field: ['id', 'contract_title1', 'company_name'],
      query: 'id=6342',
    })
  })

  it('fetches the record directly when no projection was asked for', async () => {
    arrange(res({ json: { success: true, result: { id: 6342 } } }))

    await READ(createMockRequest('POST', { ...baseBody, recordId: '6342' }))

    const [url, , init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(url).toContain('/contract/6342?lang=en')
    expect(init.method).toBe('GET')
  })
})

describe('optional inputs arriving as null', () => {
  it('accepts a null page instead of rejecting the call before it is made', async () => {
    arrange(res({ json: { success: true, result: [] } }))

    const response = await SEARCH(
      createMockRequest('POST', {
        ...baseBody,
        query: "status='Active'",
        page: null,
        limit: null,
        fields: null,
        search: null,
      })
    )
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(true)
    expect(data.error).toBeUndefined()
  })

  it('omits unset optional fields from the search body rather than sending null', async () => {
    arrange(res({ json: { success: true, result: [] } }))

    await SEARCH(createMockRequest('POST', { ...baseBody, query: "status='Active'", page: null }))

    const [, , init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(JSON.parse(init.body as string)).toEqual({ query: "status='Active'" })
  })
})

describe('search result ceiling', () => {
  it('caps the returned records, since alrest honouring limit is unverified', async () => {
    arrange(
      res({
        json: {
          success: true,
          result: Array.from({ length: 250 }, (_, i) => ({ id: i })),
        },
      })
    )

    const response = await SEARCH(
      createMockRequest('POST', { ...baseBody, query: "status='Active'" })
    )
    const data = (await response.json()) as {
      output: { records: unknown[]; totalCount: number }
    }

    expect(data.output.records).toHaveLength(200)
    expect(data.output.totalCount).toBe(200)
  })
})

describe('review round 1 fixes', () => {
  it('fails a create that comes back without a record ID', async () => {
    arrange(res({ json: { success: true, result: {} } }))

    const response = await POST(createMockRequest('POST', { ...baseBody, data: '{"a":"b"}' }))
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('did not return an ID')
  })

  it('refuses a non-numeric record ID on a projected read rather than interpolating it', async () => {
    const response = await READ(
      createMockRequest('POST', {
        ...baseBody,
        recordId: "1' || priority='High",
        fields: 'contract_title1',
      })
    )
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('must be numeric')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('does not return an unrelated record when the search matches something else', async () => {
    arrange(res({ json: { success: true, result: [{ id: 99, contract_title1: 'Other' }] } }))

    const response = await READ(
      createMockRequest('POST', { ...baseBody, recordId: '6342', fields: 'contract_title1' })
    )
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('no record for ID 6342')
  })
})

describe('documented EWREST response keys', () => {
  it('reads the choice line ID from EWREST_choiceLineId', async () => {
    const { POST: CHOICE } = await import('@/app/api/tools/agiloft/get_choice_line_id/route')
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ text: "EWREST_choiceLineId = '1';" })
    )

    const response = await CHOICE(
      createMockRequest('POST', { ...baseBody, fieldName: 'priority', value: 'High' })
    )
    const data = (await response.json()) as { success: boolean; output: { choiceLineId: number } }

    expect(data.success).toBe(true)
    expect(data.output.choiceLineId).toBe(1)
  })
})

describe('EWTable', () => {
  it('is KB-scoped: no $table, mandatory .json, and no inline credentials', async () => {
    const { POST: LIST } = await import('@/app/api/tools/agiloft/list_tables/route')
    arrange(res({ json: { success: true, result: { tables: [] } } }))

    await LIST(
      createMockRequest('POST', {
        instanceUrl: baseBody.instanceUrl,
        knowledgeBase: baseBody.knowledgeBase,
        login: baseBody.login,
        password: baseBody.password,
        includeLinkedInfo: true,
      })
    )

    const [url, , init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(url).toContain('/ewws/EWTable/.json?')
    expect(url).toContain('&includelinkedinfo=true')
    expect(url).not.toContain('$table=')
    expect(url).not.toContain('$password')
    expect(init.headers.Authorization).toBe('Bearer tok-123')
  })

  it('narrows to one table with the plain table parameter, not $table', async () => {
    const { POST: LIST } = await import('@/app/api/tools/agiloft/list_tables/route')
    arrange(res({ json: { success: true, result: { tables: [] } } }))

    await LIST(createMockRequest('POST', { ...baseBody, table: 'contacts' }))

    const [url] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[1]
    expect(url).toContain('&table=contacts')
    expect(url).not.toContain('$table=')
  })

  it('flattens tables and fields into the documented shape', async () => {
    const { POST: LIST } = await import('@/app/api/tools/agiloft/list_tables/route')
    arrange(
      res({
        json: {
          success: true,
          result: {
            tables: [
              {
                label: 'WMI Sample',
                logicalName: 'wmi_sample',
                fields: [
                  {
                    columnLabel: 'ID',
                    columnName: 'id',
                    columnType: 'BIGINT',
                    columnTypeDomain: 'swautoincrementfield',
                  },
                  {
                    columnLabel: 'Updated By',
                    columnName: '_1794_full_name',
                    columnType: 'VARCHAR',
                    columnTypeDomain: 'swshorttextfield',
                    isLinked: true,
                    linkedInfo: [
                      {
                        linkedTable: 'contacts',
                        linkedColumn: 'full_name',
                        linkedDao: '_dao3_link0',
                      },
                    ],
                    textFieldType: 'text/plain',
                  },
                ],
              },
            ],
          },
        },
      })
    )

    const response = await LIST(createMockRequest('POST', baseBody))
    const data = (await response.json()) as {
      output: { tables: Array<{ logicalName: string; fields: unknown[] }>; totalCount: number }
    }

    expect(data.output.totalCount).toBe(1)
    expect(data.output.tables[0].logicalName).toBe('wmi_sample')
    expect(data.output.tables[0].fields).toEqual([
      {
        columnName: 'id',
        columnLabel: 'ID',
        columnType: 'BIGINT',
        columnTypeDomain: 'swautoincrementfield',
        required: false,
        isLinked: false,
        linkedInfo: [],
        textFieldType: null,
      },
      {
        columnName: '_1794_full_name',
        columnLabel: 'Updated By',
        columnType: 'VARCHAR',
        columnTypeDomain: 'swshorttextfield',
        required: false,
        isLinked: true,
        // includeLinkedInfo must actually surface the source table/column.
        linkedInfo: [{ linkedTable: 'contacts', linkedColumn: 'full_name' }],
        textFieldType: 'text/plain',
      },
    ])
  })
})

describe('EWUpsert', () => {
  const upsertBody = { ...baseBody, match: 'ext_id', data: '{"first_name":"John"}' }

  it('sends every parameter in the form body, keeping credentials out of the URL', async () => {
    const { POST: UPSERT } = await import('@/app/api/tools/agiloft/upsert_record/route')
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ status: 201, text: "EWREST_id='353';" })
    )

    await UPSERT(createMockRequest('POST', upsertBody))

    const calls = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls
    // Inline-credential auth: a single call, no login/logout pair.
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('https://example.agiloft.com/ewws/EWUpsert')
    expect(calls[0][0]).not.toContain('?')

    const sent = new URLSearchParams(calls[0][2].body as string)
    expect(sent.get('$match')).toBe('ext_id')
    expect(sent.get('$table')).toBe('contract')
    expect(sent.get('$password')).toBe(PLACEHOLDER_PASSWORD)
    expect(sent.get('first_name')).toBe('John')
  })

  it('reports 201 as a create and 200 as an update', async () => {
    const { POST: UPSERT } = await import('@/app/api/tools/agiloft/upsert_record/route')

    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ status: 201, text: "EWREST_id='353';" })
    )
    let data = (await (await UPSERT(createMockRequest('POST', upsertBody))).json()) as {
      output: { id: string; created: boolean }
    }
    expect(data.output).toEqual({ id: '353', created: true, callbackId: null })

    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ status: 200, text: "EWREST_id='353';" })
    )
    data = (await (await UPSERT(createMockRequest('POST', upsertBody))).json()) as {
      output: { id: string; created: boolean }
    }
    expect(data.output).toEqual({ id: '353', created: false, callbackId: null })
  })

  it('surfaces a 409 as an ambiguous match rather than a generic failure', async () => {
    const { POST: UPSERT } = await import('@/app/api/tools/agiloft/upsert_record/route')
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ ok: false, status: 409, text: 'Multiple matching records found' })
    )

    const response = await UPSERT(createMockRequest('POST', upsertBody))
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('more than one record matching "ext_id"')
  })
})

describe('EWAsyncStatus', () => {
  const statusBody = { ...baseBody, callbackId: '10100_1' }

  it('maps each documented status code to its meaning', async () => {
    const { POST: STATUS } = await import('@/app/api/tools/agiloft/async_status/route')

    const cases: Array<[number, string, boolean]> = [
      [200, 'completed', true],
      [201, 'queued', false],
      [202, 'in_progress', false],
      [501, 'failed', true],
      [523, 'unknown_callback', true],
    ]

    for (const [status, expected, complete] of cases) {
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
        res({ ok: status < 400, status, text: '' })
      )

      const response = await STATUS(createMockRequest('POST', statusBody))
      const data = (await response.json()) as {
        success: boolean
        output: { status: string; complete: boolean; statusCode: number }
      }

      // 501 is a failed *operation*, not a failed status check.
      expect(data.success).toBe(true)
      expect(data.output).toMatchObject({ status: expected, complete, statusCode: status })
    }
  })

  it('authenticates inline and sends the documented callback_id param', async () => {
    const { POST: STATUS } = await import('@/app/api/tools/agiloft/async_status/route')
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ status: 200, text: '' })
    )

    await STATUS(createMockRequest('POST', statusBody))

    const calls = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toContain('/ewws/EWAsyncStatus?')
    expect(calls[0][0]).toContain('&callback_id=10100_1')
  })
})

describe('EWActionButton single-line response', () => {
  it('parses both assignments when Agiloft returns them on one line', async () => {
    const { POST: ACTION } = await import('@/app/api/tools/agiloft/run_action_button/route')
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ text: "EWREST_id='82'; EWREST_EWCALLBACK_ID='10100_1';" })
    )

    const response = await ACTION(
      createMockRequest('POST', { ...baseBody, recordId: '82', actionButtonField: 'ab_field' })
    )
    const data = (await response.json()) as {
      success: boolean
      output: { recordId: string; callbackId: string | null }
    }

    expect(data.output.recordId).toBe('82')
    expect(data.output.callbackId).toBe('10100_1')
  })
})

describe('review round 2 fixes', () => {
  const upsertBody = { ...baseBody, match: 'ext_id', data: '{"a":"b"}' }

  it('returns a callback ID for a queued upsert so Async Status can poll it', async () => {
    const { POST: UPSERT } = await import('@/app/api/tools/agiloft/upsert_record/route')
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ status: 202, text: "EWREST_EWCALLBACK_ID='10100_7';" })
    )

    const response = await UPSERT(createMockRequest('POST', upsertBody))
    const data = (await response.json()) as {
      success: boolean
      output: { id: string | null; callbackId: string | null }
    }

    expect(data.success).toBe(true)
    expect(data.output.callbackId).toBe('10100_7')
  })

  it('matches a projected read on the canonical numeric ID, not the string', async () => {
    arrange(res({ json: { success: true, result: [{ id: 123, contract_title1: 'X' }] } }))

    // Agiloft echoes 123 for a request made as 00123.
    const response = await READ(
      createMockRequest('POST', { ...baseBody, recordId: '00123', fields: 'contract_title1' })
    )
    const data = (await response.json()) as { success: boolean; output: { id: string | null } }

    expect(data.success).toBe(true)
    expect(data.output.id).toBe('123')
  })
})

describe('review round 3 fixes', () => {
  it('reports an Agiloft refusal as a non-retryable failure, not a 500', async () => {
    arrange(
      res({ json: { success: false, errors: [{ message: 'Field contract_title1 is required' }] } })
    )

    const response = await POST(createMockRequest('POST', { ...baseBody, data: '{"a":"b"}' }))

    /**
     * The tool runner retries 500s, and retrying a refused create can duplicate
     * a record — a refusal must come back as a settled failure.
     */
    expect(response.status).toBe(200)
    const data = (await response.json()) as { success: boolean; error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('Field contract_title1 is required')
  })

  it('tells the user what to do when EWTable login needs a table', async () => {
    const { POST: LIST } = await import('@/app/api/tools/agiloft/list_tables/route')
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({
        ok: false,
        status: 400,
        text: 'EWWrongDataException has occurred: One has to specify $table, $KB, $lang parameters',
      })
    )

    const response = await LIST(
      createMockRequest('POST', {
        instanceUrl: baseBody.instanceUrl,
        knowledgeBase: baseBody.knowledgeBase,
        login: baseBody.login,
        password: baseBody.password,
      })
    )
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('requires a table name to authenticate')
  })

  it('encodes a multi-value upsert field as repeated pairs, not a joined string', async () => {
    const { POST: UPSERT } = await import('@/app/api/tools/agiloft/upsert_record/route')
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ status: 200, text: "EWREST_id='353';" })
    )

    await UPSERT(
      createMockRequest('POST', {
        ...baseBody,
        match: 'ext_id',
        data: '{"contactMethod":["phone","email"]}',
      })
    )

    const body = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0][2].body as string
    expect(new URLSearchParams(body).getAll('contactMethod')).toEqual(['phone', 'email'])
  })

  it('refuses an object field value rather than writing [object Object]', async () => {
    const { POST: UPSERT } = await import('@/app/api/tools/agiloft/upsert_record/route')

    const response = await UPSERT(
      createMockRequest('POST', {
        ...baseBody,
        match: 'ext_id',
        data: '{"nested":{"a":1}}',
      })
    )
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('has no encoding for')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
