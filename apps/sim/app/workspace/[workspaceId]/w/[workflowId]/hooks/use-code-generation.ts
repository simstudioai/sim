import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

type GenerationType =
  | 'json-schema'
  | 'javascript-function-body'
  | 'typescript-function-body'
  | 'custom-tool-schema'
  | 'json-object'

interface UseCodeGenerationProps {
  generationType: GenerationType
  initialContext?: string // Optional initial code/schema
  onGeneratedContent: (content: string) => void
  onStreamChunk?: (chunk: string) => void
  onStreamStart?: () => void
  onGenerationComplete?: (prompt: string, generatedContent: string) => void // New callback
}

interface GenerateOptions {
  prompt: string
  context?: string // Overrides initialContext if provided
}

const logger = createLogger('useCodeGeneration')

export function useCodeGeneration({
  generationType,
  initialContext = '',
  onGeneratedContent,
  onStreamChunk,
  onStreamStart,
  onGenerationComplete,
}: UseCodeGenerationProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isPromptOpen, setIsPromptOpen] = useState(false)
  const [isPromptVisible, setIsPromptVisible] = useState(false)
  const [promptInputValue, setPromptInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  // State for conversation history
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([])

  // Use useRef for the abort controller
  const abortControllerRef = useRef<AbortController | null>(null)

  // Standard non-streaming generation
  const generate = async ({ prompt, context }: GenerateOptions) => {
    console.log('[useCodeGeneration.ts] generate function called')
    if (!prompt) {
      const errorMessage = 'Prompt cannot be empty.'
      setError(errorMessage)
      return
    }

    setIsLoading(true)
    setError(null)
    logger.debug('Starting code generation', { generationType, prompt })
    setPromptInputValue('')

    // Keep track of the current prompt for history
    const currentPrompt = prompt

    try {
      const response = await fetch('/api/codegen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          generationType,
          context: context ?? initialContext, // Use override context if available
          history: conversationHistory, // Send history
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`)
      }

      logger.info('Code generation successful', { generationType })
      onGeneratedContent(result.generatedContent)
      setIsPromptOpen(false)
      setIsPromptVisible(false)

      // Update history after successful non-streaming generation
      setConversationHistory((prevHistory) => [
        ...prevHistory,
        { role: 'user', content: currentPrompt },
        { role: 'assistant', content: result.generatedContent },
      ])

      if (onGenerationComplete) {
        onGenerationComplete(currentPrompt, result.generatedContent)
      }
    } catch (err: any) {
      const errorMessage = err.message || 'An unknown error occurred during generation.'
      logger.error('Code generation failed', { error: errorMessage })
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Streaming generation
  const generateStream = async ({ prompt, context }: GenerateOptions) => {
    if (!prompt) {
      const errorMessage = 'Prompt cannot be empty.'
      setError(errorMessage)
      return
    }

    setIsLoading(true)
    setIsStreaming(true)
    setError(null)
    setPromptInputValue('')

    // Keep track of the current prompt for history
    const currentPrompt = prompt

    // Create a new AbortController for this request
    abortControllerRef.current = new AbortController()

    logger.debug('Starting streaming code generation', { generationType, prompt })

    try {
      const response = await fetch('/api/codegen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-transform',
        },
        body: JSON.stringify({
          prompt,
          generationType,
          context: context ?? initialContext,
          stream: true,
          history: conversationHistory, // Send history
        }),
        signal: abortControllerRef.current.signal,
        // Ensure no caching for Edge Functions
        cache: 'no-store',
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `HTTP error! status: ${response.status}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      // Signal the start of the stream to clear previous content
      if (onStreamStart) {
        onStreamStart()
      }

      // Set up streaming reader
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Process incoming chunks
          const text = decoder.decode(value)
          const lines = text.split('\n').filter((line) => line.trim() !== '')

          for (const line of lines) {
            try {
              const data = JSON.parse(line)

              // Check if there's an error
              if (data.error) {
                throw new Error(data.error)
              }

              // Process chunk
              if (data.chunk) {
                fullContent += data.chunk
                if (onStreamChunk) {
                  onStreamChunk(data.chunk)
                }
              }

              // Check if streaming is complete
              if (data.done) {
                // Use full content from server if available (for validation)
                if (data.fullContent) {
                  fullContent = data.fullContent
                }

                logger.info('Streaming code generation completed', { generationType })
                // Update history AFTER the stream is fully complete
                setConversationHistory((prevHistory) => [
                  ...prevHistory,
                  { role: 'user', content: currentPrompt },
                  { role: 'assistant', content: fullContent }, // Use the final full content
                ])

                // Call the main handler for the complete content
                onGeneratedContent(fullContent)

                if (onGenerationComplete) {
                  onGenerationComplete(currentPrompt, fullContent)
                }
                break
              }
            } catch (jsonError: any) {
              logger.error('Failed to parse streaming response', { error: jsonError.message, line })
            }
          }
        }
      } catch (streamError: any) {
        // Additional error handling for stream processing
        if (streamError.name !== 'AbortError') {
          logger.error('Error processing stream', { error: streamError.message })
          throw streamError // Re-throw to be caught by outer try/catch
        }
      } finally {
        // Always release the reader when done
        reader.releaseLock()
      }
    } catch (err: any) {
      // Don't show error if it was due to an abort
      if (err.name === 'AbortError') {
        logger.info('Streaming code generation aborted', { generationType })
        return
      }

      const errorMessage = err.message || 'An unknown error occurred during streaming.'
      logger.error('Streaming code generation failed', { error: errorMessage })
      setError(errorMessage)
    } finally {
      setIsLoading(false)
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }

  const cancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setIsLoading(false)
      setIsStreaming(false)
      logger.info('Code generation canceled', { generationType })
    }
  }

  const openPrompt = () => {
    setIsPromptOpen(true)
    setPromptInputValue('')
  }

  const closePrompt = () => {
    if (isLoading) return
    setIsPromptOpen(false)
    setPromptInputValue('')
  }

  const showPromptInline = () => {
    logger.debug('showPromptInline called', { generationType })
    setIsPromptVisible(true)
    setPromptInputValue('')
  }

  const hidePromptInline = () => {
    logger.debug('hidePromptInline called', { generationType })
    if (isLoading) return
    setIsPromptVisible(false)
    setPromptInputValue('')
  }

  const updatePromptValue = (value: string) => {
    setPromptInputValue(value)
  }

  const clearHistory = useCallback(() => {
    setConversationHistory([])
    logger.info('Conversation history cleared', { generationType })
  }, [generationType])

  return {
    isLoading,
    isStreaming,
    error,
    generate,
    generateStream,
    cancelGeneration,
    isPromptOpen,
    openPrompt,
    closePrompt,
    isPromptVisible,
    showPromptInline,
    hidePromptInline,
    promptInputValue,
    updatePromptValue,
    conversationHistory,
    clearHistory,
  }
}
