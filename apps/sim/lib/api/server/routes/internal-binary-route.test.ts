import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { defineRouteContract } from '@/lib/api/contracts'
import { defineInternalBinaryRoute } from '@/lib/api/server/routes/internal-binary-route'
import {
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes/internal-json-route'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const contract = defineRouteContract({
  method: 'GET',
  path: '/api/test/download',
  response: { mode: 'binary' },
})
const operation = { id: 'test.download' } as const

describe('internal download HEAD authorization', () => {
  it.each([true, false])(
    'checks access without starting a download when allowed=%s',
    async (allowed) => {
      const handler = defineInternalBinaryRoute({
        contract,
        operation,
        headSafe: false,
        auth: { authenticate: async () => createSessionPrincipal() },
        rateLimit: internalRateLimits.none({
          reason: 'No network admission needed in this fixture',
        }),
        errorPolicy: internalOrchestrationErrorPolicy,
        mapInput: () => undefined,
        useCase: {
          operation,
          async authorize() {
            if (!allowed) throw new OrchestrationError('forbidden', 'Access denied')
          },
          async execute(): Promise<string> {
            throw new Error('HEAD must not reach download side effects')
          },
        },
        present: (body) => ({ body, contentType: 'application/octet-stream' }),
      })
      const response = await handler(
        new NextRequest('http://localhost/api/test/download', { method: 'HEAD' })
      )
      expect(response.status).toBe(allowed ? 200 : 403)
      if (allowed) expect(await response.text()).toBe('')
    }
  )
})
