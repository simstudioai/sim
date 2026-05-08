/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { type ApiClientError, isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { defineRouteContract } from '@/lib/api/contracts'

const renameContract = defineRouteContract({
  method: 'POST',
  path: '/api/test/[id]',
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z
      .string()
      .min(1, 'Name is required')
      .regex(/^[a-z_][a-z0-9_]*$/i, 'Name must start with a letter or underscore'),
  }),
  response: { mode: 'json', schema: z.object({ ok: z.literal(true) }) },
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('requestJson client-side validation', () => {
  it('translates outbound ZodError into a user-friendly ApiClientError', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not be called when client validation fails')
    })

    let caught: unknown
    try {
      await requestJson(renameContract, {
        params: { id: 'abc' },
        body: { name: 'Has Spaces' },
      })
    } catch (error) {
      caught = error
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(isApiClientError(caught)).toBe(true)
    const err = caught as ApiClientError
    expect(err.message).toBe('Name must start with a letter or underscore')
    expect(err.status).toBe(0)
    expect(err.code).toBe('client_validation_error')
  })

  it('passes valid input through to fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await requestJson(renameContract, {
      params: { id: 'abc' },
      body: { name: 'valid_name' },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })
})
