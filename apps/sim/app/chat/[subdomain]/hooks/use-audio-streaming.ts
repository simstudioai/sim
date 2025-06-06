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
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const audioChunksRef = useRef<ArrayBuffer[]>([])
  const isInitializedRef = useRef(false)
  const processingQueueRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const pendingRequestsRef = useRef<Set<Promise<void>>>(new Set())
  const hasStartedPlayingRef = useRef(false) // Track if we've started playing audio
  const initialBufferingRef = useRef(true) // Track if we're still in initial buffering phase

  // Initialize MediaSource for streaming audio
  const initializeMediaSource = useCallback(async (options: AudioStreamingOptions) => {
    const { onAudioStart, onAudioEnd } = options

    try {
      // Create audio element if it doesn't exist
      if (!audioElementRef.current) {
        audioElementRef.current = new Audio()
        audioElementRef.current.controls = false
        audioElementRef.current.autoplay = false
      }

      // Create MediaSource
      if (!mediaSourceRef.current) {
        mediaSourceRef.current = new MediaSource()

        const objectURL = URL.createObjectURL(mediaSourceRef.current)
        audioElementRef.current.src = objectURL

        // Wait for MediaSource to be ready
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('MediaSource timeout')), 10000)

          mediaSourceRef.current!.addEventListener(
            'sourceopen',
            () => {
              clearTimeout(timeout)
              resolve()
            },
            { once: true }
          )

          mediaSourceRef.current!.addEventListener(
            'error',
            (e) => {
              clearTimeout(timeout)
              reject(new Error('MediaSource error'))
            },
            { once: true }
          )
        })

        // Create SourceBuffer
        sourceBufferRef.current = mediaSourceRef.current.addSourceBuffer('audio/mpeg')

        // Set up audio element event listeners
        audioElementRef.current.addEventListener('play', () => {
          setIsPlayingAudio(true)
          hasStartedPlayingRef.current = true
          onAudioStart?.()
        })

        audioElementRef.current.addEventListener('ended', () => {
          setIsPlayingAudio(false)
          hasStartedPlayingRef.current = false
          onAudioEnd?.()
        })

        audioElementRef.current.addEventListener('pause', () => {
          setIsPlayingAudio(false)
          if (hasStartedPlayingRef.current) {
            onAudioEnd?.()
          }
        })

        audioElementRef.current.addEventListener('error', (e) => {
          logger.error('Audio playback error:', e)
          setIsPlayingAudio(false)
          hasStartedPlayingRef.current = false
          onAudioEnd?.()
        })
      }

      isInitializedRef.current = true
      return true
    } catch (error) {
      logger.error('Failed to initialize MediaSource:', error)
      isInitializedRef.current = false
      return false
    }
  }, [])

  // Process queued audio chunks
  const processAudioChunks = useCallback(() => {
    if (
      processingQueueRef.current ||
      !sourceBufferRef.current ||
      audioChunksRef.current.length === 0
    ) {
      return
    }

    // During initial buffering, wait for at least 2-3 chunks before starting playback
    if (initialBufferingRef.current && audioChunksRef.current.length < 2) {
      return
    }

    if (sourceBufferRef.current.updating) {
      // Wait for current update to finish
      const handleUpdateEnd = () => {
        sourceBufferRef.current!.removeEventListener('updateend', handleUpdateEnd)
        processAudioChunks()
      }
      sourceBufferRef.current.addEventListener('updateend', handleUpdateEnd, { once: true })
      return
    }

    processingQueueRef.current = true

    try {
      const chunk = audioChunksRef.current.shift()
      if (chunk) {
        sourceBufferRef.current.appendBuffer(chunk)

        // Set up listener for when this chunk is processed
        const handleUpdateEnd = () => {
          sourceBufferRef.current!.removeEventListener('updateend', handleUpdateEnd)
          processingQueueRef.current = false

          // After processing the first chunk, we're no longer in initial buffering
          if (initialBufferingRef.current) {
            initialBufferingRef.current = false
            // Start playback now that we have enough buffered data
            if (audioElementRef.current?.paused) {
              audioElementRef.current.play().catch((e) => {
                logger.error('Error starting audio playback:', e)
              })
            }
          }

          // Process next chunk if available, with a small delay to allow smooth playback
          if (audioChunksRef.current.length > 0) {
            setTimeout(() => processAudioChunks(), 5)
          }
        }

        sourceBufferRef.current.addEventListener('updateend', handleUpdateEnd, { once: true })
      } else {
        processingQueueRef.current = false
      }
    } catch (error) {
      logger.error('Error processing audio chunk:', error)
      processingQueueRef.current = false
    }
  }, [])

  // Stop all audio playback and cleanup
  const stopAudio = useCallback(() => {
    // Abort ongoing requests
    abortControllerRef.current?.abort()
    pendingRequestsRef.current.forEach((request) => {
      // Requests will be aborted by the AbortController
    })
    pendingRequestsRef.current.clear()

    // Stop audio playback and clear source to silence audio immediately
    if (audioElementRef.current) {
      audioElementRef.current.pause()
      audioElementRef.current.currentTime = 0
      // Clearing the src and calling load guarantees the element is silent
      audioElementRef.current.src = ''
      audioElementRef.current.load()
    }

    // Immediately update state
    setIsPlayingAudio(false)
    hasStartedPlayingRef.current = false

    // Clear audio chunks
    audioChunksRef.current = []
    processingQueueRef.current = false

    // Reset initialization and buffering state
    isInitializedRef.current = false
    initialBufferingRef.current = true

    // Clean up MediaSource
    if (mediaSourceRef.current) {
      try {
        if (sourceBufferRef.current && !sourceBufferRef.current.updating) {
          mediaSourceRef.current.removeSourceBuffer(sourceBufferRef.current)
        }
        mediaSourceRef.current.endOfStream()
      } catch (e) {
        // Ignore cleanup errors
      }
      mediaSourceRef.current = null
      sourceBufferRef.current = null
    }

    // Clean up audio element
    if (audioElementRef.current) {
      URL.revokeObjectURL(audioElementRef.current.src)
      audioElementRef.current.removeEventListener('play', () => {})
      audioElementRef.current.removeEventListener('ended', () => {})
      audioElementRef.current.removeEventListener('pause', () => {})
      audioElementRef.current.removeEventListener('error', () => {})
      audioElementRef.current = null
    }
  }, [])

  // Create new abort controller for requests
  const createAbortController = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    return abortControllerRef.current
  }, [])

  // Stream text to TTS and append to existing MediaSource
  const streamTextToAudio = useCallback(
    async (text: string, options: AudioStreamingOptions) => {
      const { voiceId, modelId = 'eleven_turbo_v2_5', onError } = options

      // Skip empty text
      if (!text.trim()) {
        return
      }

      // Always create a fresh AbortController for every new streaming session.
      // If the previous controller was already aborted, fetches would fail immediately.
      if (!abortControllerRef.current || abortControllerRef.current.signal.aborted) {
        createAbortController()
      }

      try {
        // Initialize MediaSource if this is the first chunk
        if (!isInitializedRef.current) {
          const initialized = await initializeMediaSource(options)
          if (!initialized) {
            // Fallback to simple audio playback
            return fallbackAudioPlayback(text, options)
          }
        }

        // Reset initial buffering state for each new streaming session
        initialBufferingRef.current = true

        // Create a request promise and track it - only after MediaSource is ready
        const requestPromise = streamAudioContent(text, {
          voiceId,
          modelId,
          onAudioChunkStart: options.onAudioChunkStart,
        })
        pendingRequestsRef.current.add(requestPromise)

        await requestPromise

        // Remove from pending requests
        pendingRequestsRef.current.delete(requestPromise)
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          logger.error('Audio streaming error:', error)
          onError?.(error)
        }
      }
    },
    [initializeMediaSource, processAudioChunks]
  )

  // Stream audio content from TTS API
  const streamAudioContent = useCallback(
    async (
      text: string,
      options: { voiceId: string; modelId?: string; onAudioChunkStart?: () => void }
    ) => {
      const { voiceId, modelId = 'eleven_turbo_v2_5', onAudioChunkStart } = options

      const endpoint = '/api/proxy/tts/stream'

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voiceId,
          modelId,
        }),
        signal: abortControllerRef.current?.signal,
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('TTS authentication failed (401). Please check server configuration.')
        }
        const errorText = await response.text()
        logger.error('TTS error response:', errorText)
        throw new Error(`TTS request failed: ${response.statusText} - ${errorText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()

      try {
        let bytesReceived = 0
        let isFirstChunk = true

        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          if (value && value.length > 0) {
            bytesReceived += value.length

            // Trigger audio start callback on first chunk
            if (isFirstChunk && !hasStartedPlayingRef.current) {
              setIsPlayingAudio(true)
              hasStartedPlayingRef.current = true
              // Don't call onAudioStart here since the audio element will handle it
            }
            isFirstChunk = false

            // Notify that a new audio chunk is being processed (for interruption reset)
            if (onAudioChunkStart) {
              onAudioChunkStart()
            }

            // Add chunk to queue
            audioChunksRef.current.push(value.buffer.slice(0))

            // Start processing chunks - will respect initial buffering requirements
            processAudioChunks()
          }
        }
      } finally {
        reader.releaseLock()
      }
    },
    [processAudioChunks]
  )

  // Fallback audio playback for full text
  const fallbackAudioPlayback = useCallback(
    async (text: string, options: AudioStreamingOptions) => {
      const { voiceId, modelId = 'eleven_turbo_v2_5', onAudioStart, onAudioEnd, onError } = options

      try {
        // Signal audio start immediately
        setIsPlayingAudio(true)
        hasStartedPlayingRef.current = true
        onAudioStart?.()

        const endpoint = '/api/proxy/tts/stream'

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            voiceId,
            modelId,
          }),
        })

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('TTS authentication failed (401). Please check server configuration.')
          }
          throw new Error(`TTS request failed: ${response.statusText}`)
        }

        const audioBlob = await response.blob()
        const audioUrl = URL.createObjectURL(audioBlob)

        const audio = new Audio(audioUrl)
        audioElementRef.current = audio

        audio.addEventListener(
          'ended',
          () => {
            URL.revokeObjectURL(audioUrl)
            setIsPlayingAudio(false)
            hasStartedPlayingRef.current = false
            onAudioEnd?.()
            audioElementRef.current = null
          },
          { once: true }
        )

        audio.addEventListener(
          'error',
          (e) => {
            logger.error('Audio playback error:', e)
            URL.revokeObjectURL(audioUrl)
            setIsPlayingAudio(false)
            hasStartedPlayingRef.current = false
            onAudioEnd?.()
            audioElementRef.current = null
          },
          { once: true }
        )

        await audio.play()
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          logger.error('Fallback audio error:', error)
          onError?.(error)
        }
        setIsPlayingAudio(false)
        hasStartedPlayingRef.current = false
        onAudioEnd?.()
      }
    },
    []
  )

  return {
    isPlayingAudio,
    streamTextToAudio,
    stopAudio,
    createAbortController,
  }
}
