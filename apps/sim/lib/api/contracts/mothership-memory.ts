import { defineRouteContract } from '@/lib/api/contracts/types'
import { MemoryScopeRequest, MemoryScopeResponse } from '@/lib/mothership/generated/memory-scope'

export const readMemoryScopeContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/memory/scope',
  body: MemoryScopeRequest,
  response: { mode: 'json', schema: MemoryScopeResponse },
})
