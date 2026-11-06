import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import {
  methodMatchesContract,
  requireBinaryRouteDefinition,
  requireJsonRouteDefinition,
} from '@/lib/api/server/routes/definition'
import { defineOperation } from '@/lib/core/application'

const renameOperation = {
  id: 'files.rename',
  minimumRole: 'write',
  workspaceApiKey: 'allow',
} as const

describe('declarative route definition invariants', () => {
  it('fails immediately when route and use-case operations differ', () => {
    expect(() =>
      requireJsonRouteDefinition(
        defineRouteContract({
          method: 'PATCH',
          path: '/files/[fileId]',
          response: { mode: 'json', schema: z.object({ ok: z.literal(true) }) },
        }),
        renameOperation,
        { ...renameOperation, id: 'files.delete' }
      )
    ).toThrow('does not match')
  })

  it('refuses a binary route whose first status cannot carry the body it serves', () => {
    const contract = (status: number[]) =>
      defineRouteContract({
        method: 'GET',
        path: '/icon',
        response: { mode: 'binary', status },
      })
    const operation = defineOperation({
      id: 'icons.get',
      principalKinds: ['session'],
      capability: 'none',
    })
    expect(() => requireBinaryRouteDefinition(contract([204, 200]), operation, operation)).toThrow(
      'carries a body first'
    )
    expect(
      requireBinaryRouteDefinition(contract([200, 204]), operation, operation).successStatus
    ).toBe(200)
  })
})

describe('methodMatchesContract', () => {
  it('accepts HEAD against a GET contract, which is how Next serves it', () => {
    expect(methodMatchesContract('HEAD', 'GET')).toBe(true)
  })

  it.each([
    ['HEAD', 'POST'],
    ['HEAD', 'DELETE'],
    ['POST', 'GET'],
    ['GET', 'DELETE'],
    ['PATCH', 'PUT'],
  ] as const)('rejects %s against a %s contract', (requestMethod, contractMethod) => {
    expect(methodMatchesContract(requestMethod, contractMethod)).toBe(false)
  })
})
