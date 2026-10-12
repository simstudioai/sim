import { defineRouteContract } from '@/lib/api/contracts/types'
import { MemoryAccessInput, MemoryAccessResult } from '@/lib/mothership/generated/memory-access'

export const resolveMemoryAccessContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/memories/access',
  body: MemoryAccessInput,
  response: { mode: 'json', schema: MemoryAccessResult },
})
