import { task } from '@trigger.dev/sdk'
import { runDrain } from '@/ee/data-drains/lib/service'
import type { RunTrigger } from '@/ee/data-drains/lib/types'

interface RunDataDrainPayload {
  drainId: string
  trigger: RunTrigger
}

export const runDataDrainTask = task({
  id: 'run-data-drain',
  run: async ({ drainId, trigger }: RunDataDrainPayload, { signal }) =>
    runDrain(drainId, trigger, { signal }),
})
