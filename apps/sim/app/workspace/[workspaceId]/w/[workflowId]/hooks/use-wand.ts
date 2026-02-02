import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { readSSEStream } from '@/lib/core/utils/sse'
import type { GenerationType } from '@/blocks/types'
import { subscriptionKeys } from '@/hooks/queries/subscription'

const logger = createLogger('useWand')

/**
 * Builds rich context information based on current content and generation type
 */
function buildContextInfo(currentValue?: string, generationType?: string): string {
  if (!currentValue || currentValue.trim() === '') {
    return 'no current content'
  }

  const contentLength = currentValue.length
  const lineCount = currentValue.split('\n').length

  let contextInfo = `Current content (${contentLength} characters, ${lineCount} lines):\n${currentValue}`

  if (generationType) {
    switch (generationType) {
      case 'javascript-function-body':
      case 'typescript-function-body': {
        const hasFunction = /function\s+\w+/.test(currentValue)
        const hasArrowFunction = /=>\s*{/.test(currentValue)
        const hasReturn = /return\s+/.test(currentValue)
        contextInfo += `\n\nCode analysis: ${hasFunction ? 'Contains function declaration. ' : ''}${hasArrowFunction ? 'Contains arrow function. ' : ''}${hasReturn ? 'Has return statement.' : 'No return statement.'}`
        break
      }

      case 'json-schema':
      case 'json-object':
        try {
          const parsed = JSON.parse(currentValue)
          const keys = Object.keys(parsed)
          contextInfo += `\n\nJSON analysis: Valid JSON with ${keys.length} top-level keys: ${keys.join(', ')}`
        } catch {
          contextInfo += `\n\nJSON analysis: Invalid JSON - needs fixing`
        }
        break
    }
  }

  return contextInfo
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface WandConfig {
  enabled: boolean
  prompt: string
  generationType?: GenerationType
  placeholder?: string
  maintainHistory?: boolean // Whether to keep conversation history
}

interface UseWandProps {
  wandConfig?: WandConfig
  currentValue?: string
  onGeneratedContent: (content: string) => void
  onStreamChunk?: (chunk: string) => void
  onStreamStart?: () => void
  onGenerationComplete?: (prompt: string, generatedContent: string) => void
}

export function useWand({
  wandConfig,
  currentValue,
  onGeneratedContent,
  onStreamChunk,
  onStreamStart,
  onGenerationComplete,
}: UseWandProps) {
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(false)
  const [isPromptVisible, setIsPromptVisible] = useState(false)
  const [promptInputValue, setPromptInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([])

  const abortControllerRef = useRef<AbortController | null>(null)

  const showPromptInline = useCallback(() => {
    setIsPromptVisible(true)
    setError(null)
  }, [])

  const hidePromptInline = useCallback(() => {
    setIsPromptVisible(false)
    setPromptInputValue('')
    setError(null)
  }, [])

  const updatePromptValue = useCallback((value: string) => {
    setPromptInputValue(value)
  }, [])

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsStreaming(false)
    setIsLoading(false)
    setError(null)
  }, [])

  const openPrompt = useCallback(() => {
    setIsPromptVisible(true)
    setPromptInputValue('')
  }, [])

  const closePrompt = useCallback(() => {
    if (isLoading) return
    setIsPromptVisible(false)
    setPromptInputValue('')
  }, [isLoading])

  const generateStream = useCallback(
    async ({ prompt }: { prompt: string }) => {
      if (!prompt) {
        setError('Prompt cannot be empty.')
        return
      }

      if (!wandConfig?.enabled) {
        setError('Wand is not enabled.')
        return
      }

      setIsLoading(true)
      setIsStreaming(true)
      setError(null)
      setPromptInputValue('')

      abortControllerRef.current = new AbortController()

      if (onStreamStart) {
        onStreamStart()
      }

      try {
        const contextInfo = buildContextInfo(currentValue, wandConfig?.generationType)

        let systemPrompt = wandConfig?.prompt || ''
        if (systemPrompt.includes('{context}')) {
          systemPrompt = systemPrompt.replace('{context}', contextInfo)
        }

        const userMessage = prompt

        const currentPrompt = prompt

        const response = await fetch('/api/wand', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-transform',
          },
          body: JSON.stringify({
            prompt: userMessage,
            systemPrompt: systemPrompt,
            stream: true,
            history: wandConfig?.maintainHistory ? conversationHistory : [],
            generationType: wandConfig?.generationType,
          }),
          signal: abortControllerRef.current.signal,
          cache: 'no-store',
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(errorText || `HTTP error! status: ${response.status}`)
        }

        if (!response.body) {
          throw new Error('Response body is null')
        }

        const accumulatedContent = await readSSEStream(response.body, {
          onChunk: onStreamChunk,
          signal: abortControllerRef.current?.signal,
        })

        if (accumulatedContent) {
          onGeneratedContent(accumulatedContent)

          if (wandConfig?.maintainHistory) {
            setConversationHistory((prev) => [
              ...prev,
              { role: 'user', content: currentPrompt },
              { role: 'assistant', content: accumulatedContent },
            ])
          }

          if (onGenerationComplete) {
            onGenerationComplete(currentPrompt, accumulatedContent)
          }
        }

        logger.debug('Wand generation completed', {
          prompt,
          contentLength: accumulatedContent.length,
        })

        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: subscriptionKeys.all })
        }, 1000)
      } catch (error: any) {
        if (error.name === 'AbortError') {
          logger.debug('Wand generation cancelled')
        } else {
          logger.error('Wand generation failed', { error })
          setError(error.message || 'Generation failed')
        }
      } finally {
        setIsLoading(false)
        setIsStreaming(false)
        abortControllerRef.current = null
      }
    },
    [
      wandConfig,
      currentValue,
      onGeneratedContent,
      onStreamChunk,
      onStreamStart,
      onGenerationComplete,
      queryClient,
    ]
  )

  return {
    isLoading,
    isStreaming,
    isPromptVisible,
    promptInputValue,
    error,
    conversationHistory,
    generateStream,
    showPromptInline,
    hidePromptInline,
    openPrompt,
    closePrompt,
    updatePromptValue,
    cancelGeneration,
  }
}
