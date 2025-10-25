'use client'

import { useCallback } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { usePreviewStore } from '@/stores/panel-new/copilot/preview-store'
import { useCopilotStore } from '@/stores/panel-new/copilot/store'
import type { CopilotMessage } from '@/stores/panel-new/copilot/types'

const logger = createLogger('useMessageFeedback')

const WORKFLOW_TOOL_NAMES = ['edit_workflow']

interface UseMessageFeedbackProps {
  setShowUpvoteSuccess: (show: boolean) => void
  setShowDownvoteSuccess: (show: boolean) => void
}

/**
 * Custom hook to handle message feedback (upvote/downvote)
 *
 * @param message - The copilot message
 * @param messages - Array of all messages in the chat
 * @param props - Success state setters from useSuccessTimers
 * @returns Feedback management utilities
 */
export function useMessageFeedback(
  message: CopilotMessage,
  messages: CopilotMessage[],
  props: UseMessageFeedbackProps
) {
  const { setShowUpvoteSuccess, setShowDownvoteSuccess } = props
  const { currentChat, workflowId } = useCopilotStore()
  const { getPreviewByToolCall, getLatestPendingPreview } = usePreviewStore()

  /**
   * Gets the full assistant response content from message
   */
  const getFullAssistantContent = useCallback((message: CopilotMessage) => {
    if (message.content?.trim()) {
      return message.content
    }

    if (message.contentBlocks && message.contentBlocks.length > 0) {
      return message.contentBlocks
        .filter((block) => block.type === 'text')
        .map((block) => block.content)
        .join('')
    }

    return message.content || ''
  }, [])

  /**
   * Finds the last user query before this assistant message
   */
  const getLastUserQuery = useCallback(() => {
    const messageIndex = messages.findIndex((msg) => msg.id === message.id)
    if (messageIndex === -1) return null

    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i].content
      }
    }
    return null
  }, [messages, message.id])

  /**
   * Extracts workflow YAML from workflow tool calls
   */
  const getWorkflowYaml = useCallback(() => {
    const allToolCalls = [
      ...(message.toolCalls || []),
      ...(message.contentBlocks || [])
        .filter((block) => block.type === 'tool_call')
        .map((block) => (block as any).toolCall),
    ]

    const workflowTools = allToolCalls.filter((toolCall) =>
      WORKFLOW_TOOL_NAMES.includes(toolCall?.name)
    )

    for (const toolCall of workflowTools) {
      const yamlContent =
        toolCall.result?.yamlContent ||
        toolCall.result?.data?.yamlContent ||
        toolCall.input?.yamlContent ||
        toolCall.input?.data?.yamlContent

      if (yamlContent && typeof yamlContent === 'string' && yamlContent.trim()) {
        return yamlContent
      }
    }

    if (currentChat?.previewYaml?.trim()) {
      return currentChat.previewYaml
    }

    for (const toolCall of workflowTools) {
      if (toolCall.id) {
        const preview = getPreviewByToolCall(toolCall.id)
        if (preview?.yamlContent?.trim()) {
          return preview.yamlContent
        }
      }
    }

    if (workflowTools.length > 0 && workflowId) {
      const latestPreview = getLatestPendingPreview(workflowId, currentChat?.id)
      if (latestPreview?.yamlContent?.trim()) {
        return latestPreview.yamlContent
      }
    }

    return null
  }, [message, currentChat, workflowId, getPreviewByToolCall, getLatestPendingPreview])

  /**
   * Submits feedback to the API
   */
  const submitFeedback = useCallback(
    async (isPositive: boolean) => {
      if (!currentChat?.id) {
        logger.error('No current chat ID available for feedback submission')
        return
      }

      const userQuery = getLastUserQuery()
      if (!userQuery) {
        logger.error('No user query found for feedback submission')
        return
      }

      const agentResponse = getFullAssistantContent(message)
      if (!agentResponse.trim()) {
        logger.error('No agent response content available for feedback submission')
        return
      }

      const workflowYaml = getWorkflowYaml()

      try {
        const requestBody: any = {
          chatId: currentChat.id,
          userQuery,
          agentResponse,
          isPositiveFeedback: isPositive,
        }

        if (workflowYaml) {
          requestBody.workflowYaml = workflowYaml
        }

        const response = await fetch('/api/copilot/feedback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
          throw new Error(`Failed to submit feedback: ${response.statusText}`)
        }

        await response.json()
      } catch (error) {
        logger.error('Error submitting feedback:', error)
      }
    },
    [currentChat, getLastUserQuery, getFullAssistantContent, message, getWorkflowYaml]
  )

  /**
   * Handles upvote action
   */
  const handleUpvote = useCallback(async () => {
    setShowDownvoteSuccess(false)
    setShowUpvoteSuccess(true)
    await submitFeedback(true)
  }, [submitFeedback])

  /**
   * Handles downvote action
   */
  const handleDownvote = useCallback(async () => {
    setShowUpvoteSuccess(false)
    setShowDownvoteSuccess(true)
    await submitFeedback(false)
  }, [submitFeedback])

  return {
    handleUpvote,
    handleDownvote,
  }
}
