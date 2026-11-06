import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  MemoryNotesAccessInput,
  MemoryNotesAccessResult,
} from '@/lib/mothership/generated/memory-notes-access'

export const resolveMemoryNotesAccessContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/memories/access',
  body: MemoryNotesAccessInput,
  response: { mode: 'json', schema: MemoryNotesAccessResult },
})
