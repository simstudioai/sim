import { task } from '@trigger.dev/sdk'
import { runDrain } from '@/lib/data-drains/service'
import type { RunTrigger } from '@/lib/data-drains/types'

interface RunDataDrainPayload {
  drainId: string
  trigger: RunTrigger
}

export const runDataDrainTask = task({
  id: 'run-data-drain',
  /**
   * The drain cursor commits only after the last chunk is delivered, so a run
   * cut off by its ceiling restarts from the old cursor and re-exports the same
   * rows. A shorter cap would loop a large drain forever.
   */
  maxDuration: 5400,
  /**
   * Enqueue sites key runs by `data-drain:<id>`; this limit is what makes that
   * key serialize one drain's runs instead of granting each key the
   * environment's full concurrency.
   */
  queue: { concurrencyLimit: 1 },
  run: async ({ drainId, trigger }: RunDataDrainPayload, { signal }) =>
    runDrain(drainId, trigger, { signal }),
})
