'use client'

import { useCallback, useRef, useState } from 'react'

interface AudioStreamingOptions {
  voiceId: string
  modelId?: string
  onAudioStart?: () => void
  onAudioEnd?: () => void
  onError?: (error: Error) => void
  useOptimizedStreaming?: boolean
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

  // Initialize MediaSource for streaming audio
  const initializeMediaSource = useCallback(async (options: AudioStreamingOptions) => {
    const { onAudioStart, onAudioEnd } = options

    try {
      // Create audio element if it doesn't exist
      if (!audioElementRef.current) {
        audioElementRef.current = new Audio()
        audioElementRef.current.controls = false
        audioElementRef.current.autoplay = true
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
          onAudioStart?.()
        })

        audioElementRef.current.addEventListener('ended', () => {
          setIsPlayingAudio(false)
          onAudioEnd?.()
        })

        audioElementRef.current.addEventListener('error', (e) => {
          console.error('Audio playback error:', e)
          setIsPlayingAudio(false)
          onAudioEnd?.()
        })
      }

      isInitializedRef.current = true
      return true
    } catch (error) {
      console.error('Failed to initialize MediaSource:', error)
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

          // Process next chunk if available
          if (audioChunksRef.current.length > 0) {
            setTimeout(() => processAudioChunks(), 10)
          }
        }

        sourceBufferRef.current.addEventListener('updateend', handleUpdateEnd, { once: true })
      } else {
        processingQueueRef.current = false
      }
    } catch (error) {
      console.error('Error processing audio chunk:', error)
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

    // Stop audio playback
    if (audioElementRef.current) {
      audioElementRef.current.pause()
      audioElementRef.current.currentTime = 0
    }

    setIsPlayingAudio(false)

    // Clear audio chunks
    audioChunksRef.current = []
    processingQueueRef.current = false

    // Reset initialization
    isInitializedRef.current = false

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
      const {
        voiceId,
        modelId = 'eleven_turbo_v2_5',
        onError,
        useOptimizedStreaming = false,
      } = options

      // Skip empty text
      if (!text.trim()) return

      try {
        // Initialize MediaSource if this is the first chunk
        if (!isInitializedRef.current) {
          const initialized = await initializeMediaSource(options)
          if (!initialized) {
            // Fallback to simple audio playback
            return fallbackAudioPlayback(text, options)
          }
        }

        // Create a request promise and track it
        const requestPromise = streamAudioContent(text, { voiceId, modelId, useOptimizedStreaming })
        pendingRequestsRef.current.add(requestPromise)

        await requestPromise

        // Remove from pending requests
        pendingRequestsRef.current.delete(requestPromise)
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Audio streaming error:', error)
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
      options: { voiceId: string; modelId?: string; useOptimizedStreaming?: boolean }
    ) => {
      const { voiceId, modelId = 'eleven_turbo_v2_5', useOptimizedStreaming = false } = options

      // Choose endpoint based on optimization preference
      const endpoint = useOptimizedStreaming ? '/api/proxy/tts/websocket' : '/api/proxy/tts/stream'

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
        throw new Error(`TTS request failed: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          if (value && value.length > 0) {
            // Add chunk to queue
            audioChunksRef.current.push(value.buffer.slice(0))

            // Start processing chunks immediately for real-time feel
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
      const {
        voiceId,
        modelId = 'eleven_turbo_v2_5',
        onAudioStart,
        onAudioEnd,
        onError,
        useOptimizedStreaming = false,
      } = options

      try {
        if (!isPlayingAudio) {
          setIsPlayingAudio(true)
          onAudioStart?.()
        }

        const endpoint = useOptimizedStreaming
          ? '/api/proxy/tts/websocket'
          : '/api/proxy/tts/stream'

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
            onAudioEnd?.()
            audioElementRef.current = null
          },
          { once: true }
        )

        audio.addEventListener(
          'error',
          (e) => {
            console.error('Audio playback error:', e)
            URL.revokeObjectURL(audioUrl)
            setIsPlayingAudio(false)
            onAudioEnd?.()
            audioElementRef.current = null
          },
          { once: true }
        )

        await audio.play()
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Fallback audio error:', error)
          onError?.(error)
        }
        setIsPlayingAudio(false)
        onAudioEnd?.()
      }
    },
    [isPlayingAudio]
  )

  return {
    isPlayingAudio,
    streamTextToAudio,
    stopAudio,
    createAbortController,
  }
}
