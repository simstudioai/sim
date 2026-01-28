import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

const logger = createLogger('SleepServerTool')

/** Maximum sleep duration in seconds (3 minutes) */
const MAX_SLEEP_SECONDS = 180

export const SleepInput = z.object({
  seconds: z.number().min(0).max(MAX_SLEEP_SECONDS).optional().default(0),
})

export const SleepResult = z.object({
  sleptFor: z.number(),
  success: z.boolean(),
})

export type SleepInputType = z.infer<typeof SleepInput>
export type SleepResultType = z.infer<typeof SleepResult>

export const sleepServerTool: BaseServerTool<SleepInputType, SleepResultType> = {
  name: 'sleep',
  async execute(args: unknown, _context?: { userId: string }) {
    const parsed = SleepInput.parse(args)
    let seconds = parsed.seconds

    // Clamp to max
    if (seconds > MAX_SLEEP_SECONDS) {
      seconds = MAX_SLEEP_SECONDS
    }

    logger.info('Starting sleep', { seconds })

    // Actually sleep
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))

    logger.info('Sleep completed', { seconds })

    return SleepResult.parse({
      sleptFor: seconds,
      success: true,
    })
  },
}
