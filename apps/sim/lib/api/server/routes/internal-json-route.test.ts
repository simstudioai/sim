/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalPlainOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes/internal-json-route'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const operation = { id: 'test.read' } as const
const auth = {
  authenticate: vi.fn(async () => ({
    kind: 'session' as const,
    userId: 'user-1',
    sessionId: 'session-1',
  })),
}

const contract = defineRouteContract({
  method: 'GET',
  path: '/api/test/internal-json-route',
  response: {
    mode: 'json',
    schema: z.object({ value: z.string() }),
  },
})

describe('defineInternalJsonRoute', () => {
  it('uses the use-case result directly when it already matches the contract', async () => {
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalPlainOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute() {
          return { value: 'ok' }
        },
      },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ value: 'ok' })
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('renders typed error descriptors through the shared builder', async () => {
    const handler = defineInternalJsonRoute({
      contract,
      auth,
      operation,
      rateLimit: internalRateLimits.none({ reason: 'Unit test' }),
      errorPolicy: internalPlainOrchestrationErrorPolicy,
      mapInput: () => undefined,
      useCase: {
        operation,
        async execute(): Promise<{ value: string }> {
          throw new OrchestrationError('conflict', 'Already exists')
        },
      },
    })

    const response = await handler(new NextRequest('http://localhost/api/test/internal-json-route'))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Already exists' })
  })

  it('rejects invalid error statuses immediately', () => {
    expect(() => internalErrorResponse(200, { error: 'Invalid' })).toThrow(
      'Internal error responses require a 4xx or 5xx status'
    )
  })
})
