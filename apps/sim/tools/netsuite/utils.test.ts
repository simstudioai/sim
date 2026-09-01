/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeNetsuiteBatchCreateRecordsOperation } from '@/lib/internal/netsuite/operations/batch-create-records'
import { executeNetsuiteCreateRecordOperation } from '@/lib/internal/netsuite/operations/create-record'
import { executeNetsuiteGetRecordOperation } from '@/lib/internal/netsuite/operations/get-record'
import { executeNetsuiteGetServerTimeOperation } from '@/lib/internal/netsuite/operations/get-server-time'
import type { NetSuiteAuthParams } from '@/tools/netsuite/types'
import {
  buildBatchWriteRequest,
  normalizeBatchIds,
  normalizeBatchItems,
  normalizePagination,
  normalizeSuiteTalkUrl,
} from '@/tools/netsuite/utils'

const AUTH: NetSuiteAuthParams = {
  oauthCredential: 'credential-id',
  accessToken: 'access-token',
  instanceUrl: 'https://1234567-sb1.suitetalk.api.netsuite.com',
}

interface FetchCall {
  url: string
  init?: RequestInit
}

function jsonResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function installFetch(
  apiResponses: Response[] = [jsonResponse({ serverTime: '2026-08-08T00:00:00Z' })]
) {
  const calls: FetchCall[] = []
  let apiCount = 0
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    calls.push({ url, init })
    const response = apiResponses[apiCount]
    apiCount += 1
    return response ?? jsonResponse({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

async function executeServerTime(auth: NetSuiteAuthParams = AUTH, signal?: AbortSignal) {
  const execute = executeNetsuiteGetServerTimeOperation
  if (!execute) throw new Error('NetSuite tool is missing direct execution')
  return execute(auth, signal)
}

describe('NetSuite shared executor', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('accepts only authoritative NetSuite SuiteTalk origins', () => {
    expect(normalizeSuiteTalkUrl(AUTH.instanceUrl ?? '')).toBe(AUTH.instanceUrl)
    expect(normalizeSuiteTalkUrl(`${AUTH.instanceUrl}/`)).toBe(AUTH.instanceUrl)
    for (const invalid of [
      'http://1234567.suitetalk.api.netsuite.com',
      'https://evil.example',
      `${AUTH.instanceUrl}/services/rest/record/v1/customer`,
      `${AUTH.instanceUrl}?account=other`,
      'https://user:password@1234567.suitetalk.api.netsuite.com',
    ]) {
      expect(() => normalizeSuiteTalkUrl(invalid), invalid).toThrow('SuiteTalk URL')
    }
  })

  it('uses only the resolved short-lived token for SuiteTalk requests', async () => {
    const { calls } = installFetch()

    const result = await executeServerTime()

    expect(result.success).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${AUTH.instanceUrl}/services/rest/system/v1/serverTime`)
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe(
      `Bearer ${AUTH.accessToken}`
    )
  })

  it('returns a 401 after exactly one mutation request without replaying it', async () => {
    const { calls } = installFetch([
      jsonResponse({ detail: 'The access token is invalid.' }, 401),
      new Response(null, {
        status: 204,
        headers: { Location: '/services/rest/record/v1/customer/647' },
      }),
    ])
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')

    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      body: { companyName: 'Acme' },
    })

    expect(result).toMatchObject({ success: false, output: { status: 401, data: null } })
    expect(calls).toHaveLength(1)
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.body).toBe(JSON.stringify({ companyName: 'Acme' }))
  })

  it('combines workflow cancellation with the SuiteTalk timeout', async () => {
    const controller = new AbortController()
    const { calls } = installFetch()

    await executeServerTime(AUTH, controller.signal)

    expect(calls).toHaveLength(1)
    const suiteTalkSignal = calls[0].init?.signal
    expect(suiteTalkSignal).toBeInstanceOf(AbortSignal)
    expect(suiteTalkSignal).not.toBe(controller.signal)
    controller.abort(new Error('workflow canceled'))
    expect(suiteTalkSignal?.aborted).toBe(true)
  })

  it('bounds SuiteTalk calls even when the caller does not provide a signal', async () => {
    vi.useFakeTimers()
    let markApiStarted!: () => void
    const apiStarted = new Promise<void>((resolve) => {
      markApiStarted = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        markApiStarted()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason ?? new Error('aborted')),
            { once: true }
          )
        })
      })
    )

    const pending = executeServerTime()
    await apiStarted
    await vi.advanceTimersByTimeAsync(30_000)
    const result = await pending

    expect(result).toMatchObject({
      success: false,
      output: { status: 0, data: null },
    })
    expect(result.error).toMatch(/timeout|timed out/i)
    vi.useRealTimers()
  })

  it('settles promptly when the caller cancels an in-flight SuiteTalk request', async () => {
    const controller = new AbortController()
    let markApiStarted!: () => void
    const apiStarted = new Promise<void>((resolve) => {
      markApiStarted = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        markApiStarted()
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason ?? new Error('aborted')),
            { once: true }
          )
        })
      })
    )

    const pending = executeServerTime(AUTH, controller.signal)
    await apiStarted
    controller.abort(new Error('workflow canceled during SuiteTalk'))
    const result = await pending

    expect(result.success).toBe(false)
    expect(result.error).toContain('workflow canceled during SuiteTalk')
  })

  it('rejects an already-aborted execution before SuiteTalk traffic', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort(new Error('already canceled'))

    const result = await executeServerTime(AUTH, controller.signal)

    expect(result.success).toBe(false)
    expect(result.error).toContain('already canceled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an undocumented success status for ordinary operations', async () => {
    const location =
      'https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/async/v1/job/job-42'
    installFetch([new Response(null, { status: 204, headers: { Location: location } })])

    const result = await executeServerTime()

    expect(result.success).toBe(false)
    expect(result.output).toEqual({ status: 204, data: null })
    expect(result.error).toContain('expected HTTP 200')
  })

  it('does not parse a synchronous job record location as an asynchronous job ID', async () => {
    const location =
      'https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/record/v1/job/456'
    installFetch([new Response(null, { status: 204, headers: { Location: location } })])

    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'job',
      body: { companyName: 'Implementation' },
    })

    expect(result).toEqual({
      success: true,
      output: { status: 204, data: null, location },
    })
  })

  it('requires a valid same-origin resource Location on create success', async () => {
    const relativeLocation = '/services/rest/record/v1/customer/647'
    const { calls } = installFetch([
      new Response(null, { status: 204, headers: { Location: relativeLocation } }),
      new Response(null, {
        status: 204,
        headers: { Location: 'https://evil.example/services/rest/record/v1/customer/648' },
      }),
    ])
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')

    const relative = await execute({
      ...AUTH,
      recordType: 'customer',
      body: { companyName: 'Acme' },
    })
    const foreign = await execute({
      ...AUTH,
      recordType: 'customer',
      body: { companyName: 'Other' },
    })

    expect(relative).toEqual({
      success: true,
      output: { status: 204, data: null, location: relativeLocation },
    })
    expect(foreign.success).toBe(false)
    expect(foreign.output).toEqual({ status: 204, data: null })
    expect(foreign.error).toContain('valid resource Location')
    expect(calls).toHaveLength(2)
  })

  it('accepts the documented replacement-create 201 post-state with Location', async () => {
    const location = '/services/rest/record/v1/customer/647'
    installFetch([jsonResponse({ id: '647', companyName: 'Acme' }, 201, { Location: location })])
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')

    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      body: { companyName: 'Acme' },
      replace: 'addressbook',
    })

    expect(result).toEqual({
      success: true,
      output: {
        status: 201,
        data: { id: '647', companyName: 'Acme' },
        location,
      },
    })
  })

  it('rejects oversized inline responses through the repository stream limiter', async () => {
    installFetch([
      new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(16 * 1024 * 1024 + 1) },
      }),
    ])

    const result = await executeServerTime()

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/NetSuite response|16.*MiB|exceed/i)
    expect(result.output).toEqual({ status: 200, data: null })
  })

  it('rejects oversized request bodies before SuiteTalk traffic', async () => {
    const { calls } = installFetch()
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')

    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      body: { memo: 'x'.repeat(16 * 1024 * 1024) },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('request body exceeds the inline payload limit')
    expect(calls).toHaveLength(0)
  })

  it('rejects accessor-backed and exotic request bodies without invoking custom code', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    let getterCalls = 0
    const accessorBody = {}
    Object.defineProperty(accessorBody, 'companyName', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return 'Acme'
      },
    })
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')

    const accessorResult = await execute({
      ...AUTH,
      recordType: 'customer',
      body: accessorBody,
    })
    const exoticResult = await execute({
      ...AUTH,
      recordType: 'customer',
      body: Object.create({ inherited: true }) as Record<string, unknown>,
    })

    expect(accessorResult.success).toBe(false)
    expect(accessorResult.error).toContain('plain JSON')
    expect(exoticResult.success).toBe(false)
    expect(exoticResult.error).toContain('plain JSON')
    expect(getterCalls).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects cycles and custom JSON serialization before SuiteTalk traffic', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const custom = { companyName: 'Acme', toJSON: () => ({ companyName: 'Other' }) }
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')

    const cyclicResult = await execute({ ...AUTH, recordType: 'customer', body: cyclic })
    const customResult = await execute({ ...AUTH, recordType: 'customer', body: custom })

    expect(cyclicResult.success).toBe(false)
    expect(cyclicResult.error).toContain('must not be cyclic')
    expect(customResult.success).toBe(false)
    expect(customResult.error).toContain('custom serialization')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves ordinary JSON omissions, array nulls, and shared references', async () => {
    const { calls } = installFetch([
      new Response(null, {
        status: 204,
        headers: { Location: '/services/rest/record/v1/customer/647' },
      }),
    ])
    const shared = { label: 'shared' }
    const body = {
      omitted: undefined,
      functionValue: () => 'omitted',
      symbolValue: Symbol('omitted'),
      values: [undefined, () => 'null', Symbol('null'), shared],
      left: shared,
      right: shared,
    }
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')

    const result = await execute({ ...AUTH, recordType: 'customer', body })

    expect(result.success).toBe(true)
    expect(calls[0].init?.body).toBe(JSON.stringify(body))
  })

  it('enforces the Sim JSON value-count boundary before SuiteTalk traffic', async () => {
    const { calls } = installFetch([
      new Response(null, {
        status: 204,
        headers: { Location: '/services/rest/record/v1/customer/647' },
      }),
    ])
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')
    const admittedBody = { values: Array.from({ length: 99_998 }, () => null) }
    const rejectedBody = { values: Array.from({ length: 99_999 }, () => null) }

    const admitted = await execute({ ...AUTH, recordType: 'customer', body: admittedBody })
    const rejected = await execute({ ...AUTH, recordType: 'customer', body: rejectedBody })

    expect(admitted.success).toBe(true)
    expect(rejected.success).toBe(false)
    expect(rejected.error).toContain('JSON complexity limit')
    expect(calls).toHaveLength(1)
  })

  it('enforces the Sim JSON nesting boundary before SuiteTalk traffic', async () => {
    const { calls } = installFetch([
      new Response(null, {
        status: 204,
        headers: { Location: '/services/rest/record/v1/customer/647' },
      }),
    ])
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')
    const nested = (depth: number): Record<string, unknown> => {
      let value: Record<string, unknown> = {}
      for (let index = 0; index < depth; index += 1) value = { nested: value }
      return value
    }

    const admitted = await execute({ ...AUTH, recordType: 'customer', body: nested(100) })
    const rejected = await execute({ ...AUTH, recordType: 'customer', body: nested(101) })

    expect(admitted.success).toBe(true)
    expect(rejected.success).toBe(false)
    expect(rejected.error).toContain('JSON nesting limit')
    expect(calls).toHaveLength(1)
  })

  it('does not inspect later properties after the request byte budget is exhausted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    let laterGetterCalls = 0
    const body: Record<string, unknown> = { memo: 'x'.repeat(16 * 1024 * 1024) }
    Object.defineProperty(body, 'later', {
      enumerable: true,
      get: () => {
        laterGetterCalls += 1
        return 'too late'
      },
    })
    const execute = executeNetsuiteCreateRecordOperation
    if (!execute) throw new Error('NetSuite tool is missing direct execution')

    const result = await execute({ ...AUTH, recordType: 'customer', body })

    expect(result.success).toBe(false)
    expect(result.error).toContain('request body exceeds the inline payload limit')
    expect(laterGetterCalls).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-JSON success payloads instead of violating the json output contract', async () => {
    installFetch([new Response('not-json', { status: 200 })])

    const result = await executeServerTime()

    expect(result.success).toBe(false)
    expect(result.error).toContain('non-JSON success response')
    expect(result.output).toEqual({ status: 200, data: null })
  })

  it('preserves the HTTP status when an oversized Oracle error body is rejected', async () => {
    installFetch([
      new Response('{}', {
        status: 500,
        headers: { 'Content-Length': String(64 * 1024 + 1) },
      }),
    ])

    const result = await executeServerTime()

    expect(result.success).toBe(false)
    expect(result.output).toEqual({ status: 500, data: null })
    expect(result.error).toContain('NetSuite error response')
  })

  it('returns bounded, credential-sanitized Oracle errors', async () => {
    const leaked = `Rejected bearer ${AUTH.accessToken} for credential ${AUTH.oauthCredential}`
    const calls: FetchCall[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: input.toString(), init })
        return new Response(leaked, { status: 400 })
      })
    )

    const result = await executeServerTime()

    expect(result.success).toBe(false)
    expect(result.error).not.toContain(AUTH.accessToken)
    expect(result.error).not.toContain(AUTH.oauthCredential)
    expect(result.error?.length).toBeLessThanOrEqual(1_000)
    expect(calls).toHaveLength(1)
  })

  it('bounds Oracle API error details', async () => {
    installFetch([jsonResponse({ detail: 'x'.repeat(5_000) }, 400)])

    const result = await executeServerTime()

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/^NetSuite request failed \(400\):/)
    expect(result.error?.length).toBeLessThanOrEqual(1_000)
  })

  it('returns Oracle error details with machine-readable codes and paths', async () => {
    installFetch([
      jsonResponse(
        {
          type: 'https://www.rfc-editor.org/rfc/rfc9110.html#name-409-conflict',
          title: 'Conflict',
          status: 409,
          'o:errorDetails': [
            {
              detail: 'The customer reference is invalid.',
              'o:errorCode': 'INVALID_CONTENT',
              'o:errorPath': 'entity.id',
            },
            {
              detail: 'The subsidiary is required.',
              'o:errorCode': 'USER_ERROR',
              'o:errorPath': 'subsidiary',
            },
          ],
        },
        409
      ),
    ])

    const result = await executeServerTime()

    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'NetSuite request failed (409): The customer reference is invalid. [code=INVALID_CONTENT, path=entity.id]; The subsidiary is required. [code=USER_ERROR, path=subsidiary]'
    )
  })

  it('recovers the original async job when an idempotent batch retry conflicts', async () => {
    const location =
      'https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/async/v1/job/job-original'
    installFetch([
      jsonResponse(
        {
          status: 400,
          'o:errorDetails': [
            {
              detail: 'The idempotency key was already used.',
              'o:errorCode': 'IDEMPOTENCY_ERROR',
            },
          ],
        },
        400,
        { Location: location }
      ),
    ])

    const execute = executeNetsuiteBatchCreateRecordsOperation
    if (!execute) throw new Error('NetSuite batch tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
      idempotencyKey: 'retry-acme-import',
    })

    expect(result).toEqual({
      success: true,
      output: {
        status: 400,
        data: null,
        location,
        jobId: 'job-original',
      },
    })
  })

  it('does not recover an idempotency error returned with an undocumented status', async () => {
    const location =
      'https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/async/v1/job/job-original'
    installFetch([
      jsonResponse(
        {
          status: 409,
          'o:errorDetails': [
            {
              detail: 'The idempotency key was already used.',
              'o:errorCode': 'IDEMPOTENCY_ERROR',
            },
          ],
        },
        409,
        { Location: location }
      ),
    ])

    const execute = executeNetsuiteBatchCreateRecordsOperation
    if (!execute) throw new Error('NetSuite batch tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
      idempotencyKey: 'retry-acme-import',
    })

    expect(result).toEqual({
      success: false,
      output: {
        status: 409,
        data: null,
        location,
        jobId: 'job-original',
      },
      error:
        'NetSuite request failed (409): The idempotency key was already used. [code=IDEMPOTENCY_ERROR]',
    })
  })

  it('accepts Oracle relative async locations and preserves the returned header value', async () => {
    const location = '/services/rest/async/v1/job/job-relative'
    installFetch([new Response(null, { status: 202, headers: { Location: location } })])

    const execute = executeNetsuiteBatchCreateRecordsOperation
    if (!execute) throw new Error('NetSuite batch tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
    })

    expect(result).toEqual({
      success: true,
      output: { status: 202, data: null, location, jobId: 'job-relative' },
    })
  })

  it('rejects cross-origin async locations during idempotency recovery', async () => {
    const location = 'https://evil.example/services/rest/async/v1/job/job-foreign'
    installFetch([
      jsonResponse(
        {
          status: 400,
          'o:errorDetails': [
            {
              detail: 'The idempotency key was already used.',
              'o:errorCode': 'IDEMPOTENCY_ERROR',
            },
          ],
        },
        400,
        { Location: location }
      ),
    ])

    const execute = executeNetsuiteBatchCreateRecordsOperation
    if (!execute) throw new Error('NetSuite batch tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
      idempotencyKey: 'retry-acme-import',
    })

    expect(result).toEqual({
      success: false,
      output: { status: 400, data: null },
      error:
        'NetSuite request failed (400): The idempotency key was already used. [code=IDEMPOTENCY_ERROR]',
    })
  })

  it('preserves HTTP status when an async Location header is malformed', async () => {
    installFetch([
      new Response(null, {
        status: 202,
        headers: { Location: '/services/rest/async/v1/job/%ZZ' },
      }),
    ])

    const execute = executeNetsuiteBatchCreateRecordsOperation
    if (!execute) throw new Error('NetSuite batch tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
    })

    expect(result).toEqual({
      success: false,
      output: { status: 202, data: null },
      error: 'NetSuite asynchronous response did not include a valid job Location header',
    })
  })

  it('rejects async batch responses that do not include a pollable job location', async () => {
    installFetch([new Response(null, { status: 202 })])

    const execute = executeNetsuiteBatchCreateRecordsOperation
    if (!execute) throw new Error('NetSuite batch tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
    })

    expect(result).toEqual({
      success: false,
      output: { status: 202, data: null },
      error: 'NetSuite asynchronous response did not include a valid job Location header',
    })
  })

  it('requires HTTP 202 Accepted for asynchronous batch submissions', async () => {
    const location = '/services/rest/async/v1/job/job-wrong-status'
    installFetch([new Response(null, { status: 204, headers: { Location: location } })])

    const execute = executeNetsuiteBatchCreateRecordsOperation
    if (!execute) throw new Error('NetSuite batch tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
    })

    expect(result).toEqual({
      success: false,
      output: { status: 204, data: null, location, jobId: 'job-wrong-status' },
      error: 'NetSuite returned HTTP 204; expected HTTP 202',
    })
  })

  it('does not treat unrelated location-bearing errors as idempotent replays', async () => {
    const location =
      'https://1234567-sb1.suitetalk.api.netsuite.com/services/rest/async/v1/job/job-error'
    installFetch([
      jsonResponse(
        {
          status: 400,
          'o:errorDetails': [
            {
              detail: 'The batch request is invalid.',
              'o:errorCode': 'INVALID_CONTENT',
            },
          ],
        },
        400,
        { Location: location }
      ),
    ])

    const execute = executeNetsuiteBatchCreateRecordsOperation
    if (!execute) throw new Error('NetSuite batch tool is missing direct execution')
    const result = await execute({
      ...AUTH,
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
      idempotencyKey: 'retry-acme-import',
    })

    expect(result).toEqual({
      success: false,
      output: {
        status: 400,
        data: null,
        location,
        jobId: 'job-error',
      },
      error: 'NetSuite request failed (400): The batch request is invalid. [code=INVALID_CONTENT]',
    })
  })

  it('rejects malformed origins before making a network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeServerTime({ ...AUTH, instanceUrl: 'https://evil.example' })

    expect(result.success).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['oauthCredential', null, 'NetSuite credential'],
    ['accessToken', null, 'NetSuite access token'],
    ['instanceUrl', null, 'SuiteTalk URL'],
  ] as const)(
    'returns a failed response envelope for malformed direct %s',
    async (field, value, errorText) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const result = await executeServerTime({ ...AUTH, [field]: value } as never)

      expect(result).toMatchObject({
        success: false,
        output: { status: 0, data: null },
        error: expect.stringContaining(errorText),
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('rejects whitespace-only injected authentication fields before network use', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeServerTime({ ...AUTH, accessToken: '   ' })

    expect(result).toMatchObject({
      success: false,
      output: { status: 0, data: null },
      error: expect.stringContaining('NetSuite access token'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('omits null optional booleans and rejects other direct boolean values', async () => {
    const valid = installFetch([jsonResponse({ id: '7' })])
    const execute = executeNetsuiteGetRecordOperation
    if (!execute) throw new Error('NetSuite get-record tool is missing direct execution')

    const omitted = await execute({
      ...AUTH,
      recordType: 'customer',
      recordId: '7',
      expandSubResources: null,
    } as never)

    expect(omitted.success).toBe(true)
    expect(new URL(valid.calls[0].url).searchParams.has('expandSubResources')).toBe(false)

    const invalidFetch = vi.fn()
    vi.stubGlobal('fetch', invalidFetch)
    const invalid = await execute({
      ...AUTH,
      recordType: 'customer',
      recordId: '7',
      expandSubResources: 'yes',
    } as never)

    expect(invalid.success).toBe(false)
    expect(invalid.error).toContain('Expand subresources must be a boolean')
    expect(invalidFetch).not.toHaveBeenCalled()
  })
})

describe('NetSuite request bounds', () => {
  it("applies Sim's page-size default within Oracle's paging limits", () => {
    expect(normalizePagination()).toEqual({ limit: 100, offset: 0 })
    expect(normalizePagination('', '')).toEqual({ limit: 100, offset: 0 })
    expect(() => normalizePagination('   ', 0)).toThrow('Limit')
    expect(() => normalizePagination(100, '   ')).toThrow('Offset')
    expect(() => normalizePagination(0, 0)).toThrow('Limit')
    expect(normalizePagination(1_000, 2_000)).toEqual({ limit: 1_000, offset: 2_000 })
    expect(normalizePagination(1_000, 99_000)).toEqual({ limit: 1_000, offset: 99_000 })
    expect(normalizePagination(1, 999)).toEqual({ limit: 1, offset: 999 })
    expect(() => normalizePagination(1_001, 0)).toThrow('Limit')
    expect(() => normalizePagination(100, 50)).toThrow('Offset')
    expect(() => normalizePagination(100, -100)).toThrow('Offset')
    expect(() => normalizePagination(1, 1_000)).toThrow('first 1000 pages')
    expect(() => normalizePagination(1_000, 100_000)).toThrow('100,000')
    expect(() => normalizePagination(100, 100_000)).toThrow('100,000')
    expect(() => normalizePagination(1_000, 1_000_000)).toThrow('100,000')
  })

  it('enforces the 100-record batch maximum for IDs and JSON items', () => {
    const hundredIds = Array.from({ length: 100 }, (_, index) => String(index + 1)).join(',')
    const hundredItems = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
    expect(normalizeBatchIds(hundredIds).split(',')).toHaveLength(100)
    expect(normalizeBatchItems(hundredItems)).toHaveLength(100)
    expect(() => normalizeBatchIds(`${hundredIds},101`)).toThrow('100')
    expect(() => normalizeBatchIds('1,,2')).toThrow('empty comma-separated values')
    expect(() => normalizeBatchIds('1,2,')).toThrow('empty comma-separated values')
    expect(() => normalizeBatchItems([...hundredItems, { id: 101 }])).toThrow('100')
    expect(() => normalizeBatchItems([])).toThrow('between 1 and 100')
  })

  it('validates identifiers required by update and upsert batches', () => {
    const params = {
      ...AUTH,
      recordType: 'customer',
      items: [{ companyName: 'Acme' }],
    }

    expect(() => buildBatchWriteRequest('POST', params)).not.toThrow()
    expect(() => buildBatchWriteRequest('PATCH', params)).toThrow(
      'Batch item 1 must include an id or non-empty string externalId'
    )
    expect(() =>
      buildBatchWriteRequest('PATCH', { ...params, items: [{ externalId: 'EXT-7' }] })
    ).not.toThrow()
    expect(() => buildBatchWriteRequest('PUT', { ...params, items: [{ id: '7' }] })).toThrow(
      'Batch item 1 must include a non-empty string externalId'
    )
    expect(() =>
      buildBatchWriteRequest('PUT', { ...params, items: [{ externalId: '  ' }] })
    ).toThrow('Batch item 1 must include a non-empty string externalId')
    expect(() => buildBatchWriteRequest('PUT', { ...params, items: [{ externalId: 7 }] })).toThrow(
      'Batch item 1 must include a non-empty string externalId'
    )
    expect(() =>
      buildBatchWriteRequest('PUT', { ...params, items: [{ externalId: 'EXT-7' }] })
    ).not.toThrow()
    expect(() =>
      buildBatchWriteRequest('PUT', {
        ...params,
        items: [{ id: '7', externalId: 'EXT-7' }],
      })
    ).toThrow('must not include id')
  })
})
