'use client'

import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('UseAudioStreaming')

interface AudioStreamingOptions {
  voiceId: string
  modelId?: string
  onAudioStart?: () => void
  onAudioEnd?: () => void
  onError?: (error: Error) => void
  onAudioChunkStart?: () => void
}

export function useAudioStreaming() {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const sentenceQueueRef = useRef<string[]>([])
  const isProcessingQueueRef = useRef(false)

  // Helper function to split text into sentences
  const splitIntoSentences = useCallback((text: string): string[] => {
    if (!text.trim()) return []

    // More robust sentence splitting that handles various punctuation patterns
    const sentences: string[] = []

    // Split on sentence boundaries while preserving punctuation
    const parts = text.split(/([.!?]+(?:\s+|$))/)

    let currentSentence = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]

      if (/[.!?]+(?:\s+|$)/.test(part)) {
        // This is punctuation - add it to current sentence and finish
        currentSentence += part
        const trimmed = currentSentence.trim()
        if (trimmed.length > 3) {
          sentences.push(trimmed)
        }
        currentSentence = ''
      } else if (part.trim()) {
        // This is text content
        currentSentence += part
      }
    }

    // Handle any remaining text without punctuation
    if (currentSentence.trim().length > 3) {
      sentences.push(currentSentence.trim())
    }

    // If no sentences found, treat the whole text as one sentence
    if (sentences.length === 0 && text.trim().length > 3) {
      sentences.push(text.trim())
    }

    return sentences
  }, [])

  // Process sentence queue sequentially
  const processNextSentence = useCallback(async (options: AudioStreamingOptions) => {
    // Check if we should abort (queue cleared or processing stopped)
    if (isProcessingQueueRef.current || sentenceQueueRef.current.length === 0) {
      return
    }

    isProcessingQueueRef.current = true
    const sentence = sentenceQueueRef.current.shift()!

    try {
      // Double-check abort controller before making request
      if (!abortControllerRef.current || abortControllerRef.current.signal.aborted) {
        logger.info('🛑 Aborting sentence processing (interrupted)')
        isProcessingQueueRef.current = false
        return
      }

      logger.info('🎵 Playing sentence:', `${sentence.substring(0, 50)}...`)

      const response = await fetch('/api/proxy/tts/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: sentence,
          voiceId: options.voiceId,
          modelId: options.modelId || 'eleven_turbo_v2_5',
        }),
        signal: abortControllerRef.current?.signal,
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('TTS authentication failed (401). Please check server configuration.')
        }
        const errorText = await response.text()
        throw new Error(`TTS request failed: ${response.statusText} - ${errorText}`)
      }

      // Check again before proceeding to audio creation
      if (!abortControllerRef.current || abortControllerRef.current.signal.aborted) {
        logger.info('🛑 Aborting after TTS response (interrupted)')
        isProcessingQueueRef.current = false
        return
      }

      // Convert response to blob and play
      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)

      const audio = new Audio(audioUrl)
      audioElementRef.current = audio

      // Set up event listeners
      audio.addEventListener(
        'ended',
        () => {
          URL.revokeObjectURL(audioUrl)
          audioElementRef.current = null
          isProcessingQueueRef.current = false

          // Check if we should continue processing (might have been interrupted)
          if (sentenceQueueRef.current.length > 0 && !abortControllerRef.current?.signal.aborted) {
            setTimeout(() => processNextSentence(options), 100) // Small gap between sentences
          } else {
            // All sentences completed or interrupted
            setIsPlayingAudio(false)
            options.onAudioEnd?.()
            logger.info('✅ All sentences completed')
          }
        },
        { once: true }
      )

      audio.addEventListener(
        'error',
        (e) => {
          logger.error('Audio playback error:', e)
          URL.revokeObjectURL(audioUrl)
          audioElementRef.current = null
          isProcessingQueueRef.current = false

          // Continue with next sentence even if one fails (but only if not interrupted)
          if (sentenceQueueRef.current.length > 0 && !abortControllerRef.current?.signal.aborted) {
            setTimeout(() => processNextSentence(options), 100)
          } else {
            setIsPlayingAudio(false)
            options.onAudioEnd?.()
          }
        },
        { once: true }
      )

      // Start playback (final check for interruption)
      if (!abortControllerRef.current?.signal.aborted) {
        await audio.play()
      } else {
        // Clean up if interrupted before play
        URL.revokeObjectURL(audioUrl)
        audioElementRef.current = null
        isProcessingQueueRef.current = false
        logger.info('🛑 Interrupted before audio play')
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        logger.error('TTS sentence error:', error)
        options.onError?.(error)
      }

      isProcessingQueueRef.current = false

      // Continue with next sentence even if one fails (but only if not interrupted)
      if (sentenceQueueRef.current.length > 0 && !abortControllerRef.current?.signal.aborted) {
        setTimeout(() => processNextSentence(options), 100)
      } else {
        setIsPlayingAudio(false)
        options.onAudioEnd?.()
      }
    }
  }, [])

  // Stop all audio playback and cleanup
  const stopAudio = useCallback(() => {
    logger.info('🛑 stopAudio() called - stopping all audio playback')

    // Abort any ongoing requests
    if (abortControllerRef.current) {
      logger.info('🛑 Aborting audio requests')
      abortControllerRef.current.abort()
    }

    // Clear sentence queue
    const queueLength = sentenceQueueRef.current.length
    sentenceQueueRef.current = []
    isProcessingQueueRef.current = false
    logger.info(`🛑 Cleared ${queueLength} sentences from queue`)

    setIsPlayingAudio(false)
    logger.info('🛑 Set isPlayingAudio to false')

    if (audioElementRef.current) {
      try {
        logger.info('🛑 Pausing and cleaning up audio element')
        audioElementRef.current.pause()
        audioElementRef.current.currentTime = 0

        const currentSrc = audioElementRef.current.src
        audioElementRef.current.src = ''
        audioElementRef.current.load()

        if (currentSrc?.startsWith('blob:')) {
          URL.revokeObjectURL(currentSrc)
          logger.info('🛑 Revoked blob URL')
        }
      } catch (e) {
        logger.warn('Audio cleanup warning (non-critical):', e)
      }
      audioElementRef.current = null
      logger.info('🛑 Audio element cleaned up')
    } else {
      logger.info('🛑 No audio element to clean up')
    }

    logger.info('🛑✅ stopAudio() complete')
  }, [])

  // Queue-based audio streaming that handles multiple sentences
  const streamTextToAudio = useCallback(
    async (text: string, options: AudioStreamingOptions) => {
      // Skip empty text
      if (!text.trim()) {
        return
      }

      logger.info('🎵 Starting TTS for text:', `${text.substring(0, 100)}...`)

      // Create new abort controller for this request
      abortControllerRef.current = new AbortController()

      try {
        // Split text into sentences
        const sentences = splitIntoSentences(text)

        if (sentences.length === 0) {
          logger.warn('No valid sentences found in text')
          return
        }

        logger.info(`🔢 Split into ${sentences.length} sentences`)

        // Add sentences to queue
        sentenceQueueRef.current = [...sentences]

        // Start audio streaming
        setIsPlayingAudio(true)
        options.onAudioStart?.()

        // Start processing the queue
        await processNextSentence(options)
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          logger.error('TTS streaming error:', error)
          options.onError?.(error)
        }
        setIsPlayingAudio(false)
        options.onAudioEnd?.()
      }
    },
    [splitIntoSentences, processNextSentence]
  )

  const createAbortController = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    return abortControllerRef.current
  }, [])

  return {
    isPlayingAudio,
    streamTextToAudio,
    stopAudio,
    createAbortController,
  }
}
