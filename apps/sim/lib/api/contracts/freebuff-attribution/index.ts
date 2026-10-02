import {
  freebuffHandoffBodySchema,
  freebuffLandingQuerySchema,
} from '@/lib/api/contracts/freebuff-attribution/schemas'
import { defineRouteContract } from '@/lib/api/contracts/types'

export type {
  FreebuffHandoffBody,
  FreebuffLandingQuery,
} from '@/lib/api/contracts/freebuff-attribution/schemas'

export const freebuffHandoffContract = defineRouteContract({
  method: 'POST',
  path: '/api/attribution/freebuff/handoff',
  body: freebuffHandoffBodySchema,
  response: { mode: 'empty', status: 204 },
})
export const freebuffLandingContract = defineRouteContract({
  method: 'GET',
  path: '/api/attribution/freebuff',
  query: freebuffLandingQuerySchema,
  response: { mode: 'redirect', status: 303 },
})
