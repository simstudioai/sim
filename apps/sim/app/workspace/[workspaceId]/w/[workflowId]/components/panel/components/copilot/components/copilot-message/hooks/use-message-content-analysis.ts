import { useMemo } from 'react'
import { parseSpecialTags } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components'
import type { CopilotMessage } from '@/stores/panel'

interface UseMessageContentAnalysisProps {
  message: CopilotMessage
}

/**
 * Hook to analyze message content blocks for visibility and content
 * Determines if there's any visible content to display
 *
 * @param props - Configuration containing the message to analyze
 * @returns Object containing visibility analysis results
 */
export function useMessageContentAnalysis({ message }: UseMessageContentAnalysisProps) {
  const hasVisibleContent = useMemo(() => {
    if (!message.contentBlocks || message.contentBlocks.length === 0) return false
    return message.contentBlocks.some((block) => {
      if (block.type === 'text') {
        const parsed = parseSpecialTags(block.content)
        return parsed.cleanContent.trim().length > 0
      }
      return block.type === 'thinking' || block.type === 'tool_call'
    })
  }, [message.contentBlocks])

  return {
    hasVisibleContent,
  }
}
