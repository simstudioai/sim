'use client'

import { type RefObject, useCallback, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UseAudioStreaming')

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

interface AudioStreamingOptions {
  voiceId: string
  modelId?: string
  onAudioStart?: () => void
  onAudioEnd?: () => void
  onError?: (error: Error) => void
}

interface AudioQueueItem {
  text: string
  options: AudioStreamingOptions
}

export function useAudioStreaming(sharedAudioContextRef?: RefObject<AudioContext | null>) {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const localAudioContextRef = useRef<AudioContext | null>(null)
  const audioContextRef = sharedAudioContextRef || localAudioContextRef
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const audioQueueRef = useRef<AudioQueueItem[]>([])
  const isProcessingQueueRef = useRef(false)

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextConstructor) {
        throw new Error('AudioContext is not supported in this browser')
      }
      audioContextRef.current = new AudioContextConstructor()
    }
    return audioContextRef.current
  }, [])

  const stopAudio = useCallback(() => {
    abortControllerRef.current?.abort()

    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop()
      } catch (e) {
        // Already stopped
      }
      currentSourceRef.current = null
    }

    audioQueueRef.current = []
    isProcessingQueueRef.current = false

    setIsPlayingAudio(false)
  }, [])

  const processAudioQueue = useCallback(async () => {
    if (isProcessingQueueRef.current || audioQueueRef.current.length === 0) {
      return
    }

    isProcessingQueueRef.current = true
    const item = audioQueueRef.current.shift()

    if (!item) {
      isProcessingQueueRef.current = false
      return
    }

    const { text, options } = item
    const { voiceId, modelId = 'eleven_turbo_v2_5', onAudioStart, onAudioEnd, onError } = options

    try {
      const audioContext = getAudioContext()

      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      const response = await fetch('/api/proxy/tts/stream', {
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
        throw new Error(`TTS request failed: ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(audioContext.destination)
      source.onended = () => {
        currentSourceRef.current = null
        onAudioEnd?.()

        isProcessingQueueRef.current = false

        if (audioQueueRef.current.length === 0) {
          setIsPlayingAudio(false)
        }

        setTimeout(() => processAudioQueue(), 0)
      }

      currentSourceRef.current = source
      source.start(0)
      setIsPlayingAudio(true)
      onAudioStart?.()
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        logger.error('Audio streaming error:', error)
        onError?.(error)
      }

      isProcessingQueueRef.current = false
      setTimeout(() => processAudioQueue(), 0)
    }
  }, [getAudioContext])

  const streamTextToAudio = useCallback(
    async (text: string, options: AudioStreamingOptions) => {
      if (!text.trim()) {
        return
      }

      if (!abortControllerRef.current || abortControllerRef.current.signal.aborted) {
        abortControllerRef.current = new AbortController()
      }

      audioQueueRef.current.push({ text, options })
      processAudioQueue()
    },
    [processAudioQueue]
  )

  return {
    isPlayingAudio,
    streamTextToAudio,
    stopAudio,
  }
}
