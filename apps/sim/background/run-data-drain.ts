import { task } from '@trigger.dev/sdk'
import { runDrain } from '@/lib/data-drains/service'
import type { RunTrigger } from '@/lib/data-drains/types'

interface RunDataDrainPayload {
  drainId: string
  trigger: RunTrigger
}

export const runDataDrainTask = task({
  id: 'run-data-drain',
  run: async ({ drainId, trigger }: RunDataDrainPayload, { signal }) =>
    runDrain(drainId, trigger, { signal }),
})
