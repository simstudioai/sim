/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import {
  methodMatchesContract,
  requireBinaryRouteDefinition,
  requireJsonRouteDefinition,
} from '@/lib/api/server/routes/definition'

const renameOperation = {
  id: 'files.rename',
  minimumRole: 'write',
  workspaceApiKey: 'allow',
} as const

describe('declarative route definition invariants', () => {
  it('accepts one successful JSON response status', () => {
    const contract = defineRouteContract({
      method: 'PATCH',
      path: '/files/[fileId]',
      response: { mode: 'json', schema: z.object({ ok: z.literal(true) }), status: 202 },
    })

    expect(requireJsonRouteDefinition(contract, renameOperation, renameOperation)).toEqual({
      successStatus: 202,
      successStatuses: [202],
    })
  })

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

  it('accepts multiple JSON success statuses and rejects binary mode', () => {
    expect(() =>
      requireJsonRouteDefinition(
        defineRouteContract({
          method: 'GET',
          path: '/files/[fileId]',
          response: { mode: 'binary' },
        }),
        renameOperation,
        renameOperation
      )
    ).toThrow('requires a JSON response contract')

    expect(
      requireJsonRouteDefinition(
        defineRouteContract({
          method: 'PATCH',
          path: '/files/[fileId]',
          response: {
            mode: 'json',
            schema: z.object({ ok: z.literal(true) }),
            status: [200, 202],
          },
        }),
        renameOperation,
        renameOperation
      )
    ).toEqual({ successStatus: 200, successStatuses: [200, 202] })
  })

  it('accepts binary contracts and rejects JSON contracts at the binary boundary', () => {
    const binary = defineRouteContract({
      method: 'GET',
      path: '/files/[fileId]',
      response: { mode: 'binary' },
    })
    expect(requireBinaryRouteDefinition(binary, renameOperation, renameOperation)).toEqual({
      successStatus: 200,
      successStatuses: [200],
    })

    expect(() =>
      requireBinaryRouteDefinition(
        defineRouteContract({
          method: 'GET',
          path: '/files/[fileId]',
          response: { mode: 'json', schema: z.object({ ok: z.literal(true) }) },
        }),
        renameOperation,
        renameOperation
      )
    ).toThrow('requires a binary response contract')
  })

  it('rejects operation mismatches at the binary boundary', () => {
    expect(() =>
      requireBinaryRouteDefinition(
        defineRouteContract({
          method: 'GET',
          path: '/files/[fileId]',
          response: { mode: 'binary' },
        }),
        renameOperation,
        { ...renameOperation, id: 'files.download' }
      )
    ).toThrow('does not match')
  })
})

describe('methodMatchesContract', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'accepts %s against its own contract',
    (method) => {
      expect(methodMatchesContract(method, method)).toBe(true)
    }
  )

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
