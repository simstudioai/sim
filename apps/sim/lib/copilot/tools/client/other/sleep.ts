import { createLogger } from '@sim/logger'
import { Loader2, MinusCircle, Moon, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

/** Maximum sleep duration in seconds (3 minutes) */
const MAX_SLEEP_SECONDS = 180

/** Track sleep start times for calculating elapsed time on wake */
const sleepStartTimes: Record<string, number> = {}

interface SleepArgs {
  seconds?: number
}

/**
 * Format seconds into a human-readable duration string
 */
function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    return `${Math.round(seconds / 60)} minute${seconds >= 120 ? 's' : ''}`
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`
}

export class SleepClientTool extends BaseClientTool {
  static readonly id = 'sleep'

  constructor(toolCallId: string) {
    super(toolCallId, SleepClientTool.id, SleepClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to sleep', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Sleeping', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Sleeping', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Finished sleeping', icon: Moon },
      [ClientToolCallState.error]: { text: 'Interrupted sleep', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped sleep', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted sleep', icon: MinusCircle },
      [ClientToolCallState.background]: { text: 'Resumed', icon: Moon },
    },
    uiConfig: {
      secondaryAction: {
        text: 'Wake',
        title: 'Wake',
        variant: 'tertiary',
        showInStates: [ClientToolCallState.executing],
        targetState: ClientToolCallState.background,
      },
    },
    // No interrupt - auto-execute immediately
    getDynamicText: (params, state) => {
      const seconds = params?.seconds
      if (typeof seconds === 'number' && seconds > 0) {
        const displayTime = formatDuration(seconds)
        switch (state) {
          case ClientToolCallState.success:
            return `Slept for ${displayTime}`
          case ClientToolCallState.executing:
          case ClientToolCallState.pending:
            return `Sleeping for ${displayTime}`
          case ClientToolCallState.generating:
            return `Preparing to sleep for ${displayTime}`
          case ClientToolCallState.error:
            return `Failed to sleep for ${displayTime}`
          case ClientToolCallState.rejected:
            return `Skipped sleeping for ${displayTime}`
          case ClientToolCallState.aborted:
            return `Aborted sleeping for ${displayTime}`
          case ClientToolCallState.background: {
            // Calculate elapsed time from when sleep started
            const elapsedSeconds = params?._elapsedSeconds
            if (typeof elapsedSeconds === 'number' && elapsedSeconds > 0) {
              return `Resumed after ${formatDuration(Math.round(elapsedSeconds))}`
            }
            return 'Resumed early'
          }
        }
      }
      return undefined
    },
  }

  /**
   * Get elapsed seconds since sleep started
   */
  getElapsedSeconds(): number {
    const startTime = sleepStartTimes[this.toolCallId]
    if (!startTime) return 0
    return (Date.now() - startTime) / 1000
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: SleepArgs): Promise<void> {
    const logger = createLogger('SleepClientTool')

    // Use a timeout slightly longer than max sleep (3 minutes + buffer)
    const timeoutMs = (MAX_SLEEP_SECONDS + 30) * 1000

    await this.executeWithTimeout(async () => {
      const params = args || {}
      logger.debug('handleAccept() called', {
        toolCallId: this.toolCallId,
        state: this.getState(),
        hasArgs: !!args,
        seconds: params.seconds,
      })

      // Validate and clamp seconds
      let seconds = typeof params.seconds === 'number' ? params.seconds : 0
      if (seconds < 0) seconds = 0
      if (seconds > MAX_SLEEP_SECONDS) seconds = MAX_SLEEP_SECONDS

      logger.debug('Starting sleep', { seconds })

      // Track start time for elapsed calculation
      sleepStartTimes[this.toolCallId] = Date.now()

      this.setState(ClientToolCallState.executing)

      try {
        // Sleep for the specified duration
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000))

        logger.debug('Sleep completed successfully')
        this.setState(ClientToolCallState.success)
        await this.markToolComplete(200, `Slept for ${seconds} seconds`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Sleep failed', { error: message })
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(500, message)
      } finally {
        // Clean up start time tracking
        delete sleepStartTimes[this.toolCallId]
      }
    }, timeoutMs)
  }

  async execute(args?: SleepArgs): Promise<void> {
    // Auto-execute without confirmation - go straight to executing
    await this.handleAccept(args)
  }
}

// Register UI config at module load
registerToolUIConfig(SleepClientTool.id, SleepClientTool.metadata.uiConfig!)
