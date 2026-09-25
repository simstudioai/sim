import { defineRouteContract } from '@/lib/api/contracts/types'
import { RunControlRequest, RunControlState } from '@/lib/mothership/generated/run-control'

export const readRunControlContract = defineRouteContract({
  method: 'POST',
  path: '/api/mothership/runs/control',
  body: RunControlRequest,
  response: { mode: 'json', schema: RunControlState },
})
