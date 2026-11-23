import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'

export const sweepPeopleDirectoriesContract = defineRouteContract({
  method: 'GET',
  path: '/api/cron/people-directory-sync',
  response: { mode: 'json', schema: z.object({ attempted: z.number().int().nonnegative() }) },
})
