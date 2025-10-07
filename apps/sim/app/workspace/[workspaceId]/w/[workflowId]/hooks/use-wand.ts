import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import type { GenerationType } from '@/blocks/types'

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

  // Add type-specific context analysis
  if (generationType) {
    switch (generationType) {
      case 'javascript-function-body':
      case 'typescript-function-body': {
        // Analyze code structure
        const hasFunction = /function\s+\w+/.test(currentValue)
        const hasArrowFunction = /=>\s*{/.test(currentValue)
        const hasReturn = /return\s+/.test(currentValue)
        contextInfo += `\n\nCode analysis: ${hasFunction ? 'Contains function declaration. ' : ''}${hasArrowFunction ? 'Contains arrow function. ' : ''}${hasReturn ? 'Has return statement.' : 'No return statement.'}`
        break
      }

      case 'json-schema':
      case 'json-object':
        // Analyze JSON structure
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
  wandConfig: WandConfig
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
  const [isLoading, setIsLoading] = useState(false)
  const [isPromptVisible, setIsPromptVisible] = useState(false)
  const [promptInputValue, setPromptInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  // Conversation history state
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

      if (!wandConfig.enabled) {
        setError('Wand is not enabled.')
        return
      }

      setIsLoading(true)
      setIsStreaming(true)
      setError(null)
      setPromptInputValue('')

      abortControllerRef.current = new AbortController()

      // Signal the start of streaming to clear previous content
      if (onStreamStart) {
        onStreamStart()
      }

      try {
        // Build context-aware message
        const contextInfo = buildContextInfo(currentValue, wandConfig.generationType)

        // Build the system prompt with context information
        let systemPrompt = wandConfig.prompt
        if (systemPrompt.includes('{context}')) {
          systemPrompt = systemPrompt.replace('{context}', contextInfo)
        }

        // User message is just the user's specific request
        const userMessage = prompt

        // Keep track of the current prompt for history
        const currentPrompt = prompt

        const response = await fetch('/api/wand-generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-transform',
          },
          body: JSON.stringify({
            prompt: userMessage,
            systemPrompt: systemPrompt, // Send the processed system prompt with context
            stream: true,
            history: wandConfig.maintainHistory ? conversationHistory : [], // Include history if enabled
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

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let accumulatedContent = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value)
            const lines = chunk.split('\n\n')

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const lineData = line.substring(6)

                if (lineData === '[DONE]') {
                  continue
                }

                try {
                  const data = JSON.parse(lineData)

                  if (data.error) {
                    throw new Error(data.error)
                  }

                  if (data.chunk) {
                    accumulatedContent += data.chunk
                    if (onStreamChunk) {
                      onStreamChunk(data.chunk)
                    }
                  }

                  if (data.done) {
                    break
                  }
                } catch (parseError) {
                  logger.debug('Failed to parse SSE line', { line, parseError })
                }
              }
            }
          }
        } finally {
          reader.releaseLock()
        }

        if (accumulatedContent) {
          onGeneratedContent(accumulatedContent)

          if (wandConfig.maintainHistory) {
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
