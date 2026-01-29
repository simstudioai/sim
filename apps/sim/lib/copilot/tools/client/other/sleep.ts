import { Loader2, MinusCircle, Moon, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'

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

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}

// Register UI config at module load
registerToolUIConfig(SleepClientTool.id, SleepClientTool.metadata.uiConfig!)
