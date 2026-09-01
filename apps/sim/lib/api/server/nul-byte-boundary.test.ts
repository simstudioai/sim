/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { parseRequest } from '@/lib/api/server/validation'

/**
 * The character under test, written as an escape rather than a literal.
 *
 * A raw U+0000 in the source makes git classify the whole file as binary — the
 * diff renders as `Bin 0 -> 4102 bytes` and a reviewer sees none of the
 * assertions below — and editors and formatters silently strip or normalize the
 * byte. The escape produces an identical string at runtime. Do not inline it.
 * `scripts/check-source-text.ts` fails the build if one comes back.
 */
const NUL = '\u0000'

const bodyContract = defineRouteContract({
  method: 'POST',
  path: '/api/test',
  body: z.object({
    name: z.string().min(1),
    nested: z.object({ values: z.array(z.string()) }).optional(),
    cells: z.record(z.string(), z.unknown()).optional(),
  }),
  response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
})

const queryContract = defineRouteContract({
  method: 'GET',
  path: '/api/test',
  query: z.object({ search: z.string().min(1) }),
  response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
})

const paramsContract = defineRouteContract({
  method: 'GET',
  path: '/api/test/{slug}',
  params: z.object({ slug: z.string().min(1) }),
  response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
})

async function parseBody(body: unknown) {
  return parseRequest(bodyContract, createMockRequest('POST', body), {})
}

/**
 * A `U+0000` in any caller-supplied string is a hard Postgres error on the way
 * to a `text` column, and the driver's throw carries no classifiable code — so
 * every case below reached the caller as `500 INTERNAL_ERROR` rather than a
 * 400, on reads as well as writes.
 */
describe('NUL byte rejection at the contract boundary', () => {
  it('rejects a NUL in a top-level body string', async () => {
    const parsed = await parseBody({ name: `a${NUL}b` })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.response.status).toBe(400)
    expect(await parsed.response.json()).toMatchObject({
      details: [{ path: ['name'] }],
    })
  })

  it('rejects a NUL nested inside an object and an array', async () => {
    const parsed = await parseBody({ name: 'ok', nested: { values: ['fine', `bad${NUL}`] } })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(await parsed.response.json()).toMatchObject({
      details: [{ path: ['nested', 'values', 1] }],
    })
  })

  it('rejects a NUL in an unenumerated free-form record value', async () => {
    const parsed = await parseBody({ name: 'ok', cells: { anyColumn: `a${NUL}b` } })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(await parsed.response.json()).toMatchObject({
      details: [{ path: ['cells', 'anyColumn'] }],
    })
  })

  it('rejects a NUL in an object key, not only in values', async () => {
    const parsed = await parseBody({ name: 'ok', cells: { [`bad${NUL}key`]: 'value' } })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.response.status).toBe(400)
  })

  it('rejects a NUL in a query parameter on a pure read', async () => {
    const request = createMockRequest(
      'GET',
      undefined,
      {},
      `http://localhost:3000/api/test?search=${encodeURIComponent(`a${NUL}b`)}`
    )
    const parsed = await parseRequest(queryContract, request, {})

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.response.status).toBe(400)
    expect(await parsed.response.json()).toMatchObject({ details: [{ path: ['search'] }] })
  })

  it('rejects a NUL in a route path parameter', async () => {
    const parsed = await parseRequest(paramsContract, createMockRequest('GET'), {
      params: Promise.resolve({ slug: `a${NUL}b` }),
    })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.response.status).toBe(400)
  })

  it('accepts the control characters Postgres stores without complaint', async () => {
    const parsed = await parseBody({ name: 'line one\nline two\tcol\r\nbell' })

    expect(parsed.success).toBe(true)
  })

  it('accepts an escaped literal backslash-zero, which is not a NUL', async () => {
    const parsed = await parseBody({ name: String.raw`a\0b` })

    expect(parsed.success).toBe(true)
  })
})
