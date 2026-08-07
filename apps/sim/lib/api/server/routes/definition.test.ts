/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { requireJsonRouteDefinition } from '@/lib/api/server/routes/definition'

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

  it('fails immediately for binary mode or ambiguous success statuses', () => {
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

    expect(() =>
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
    ).toThrow('must declare one success status')
  })
})
