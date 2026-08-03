'use client'

import { type RefObject, useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { DEFAULT_TTS_MODEL_ID, MAX_TTS_TEXT_LENGTH } from '@/lib/api/contracts/media/tts-stream'

const logger = createLogger('UseAudioStreaming')

/** Prefer breaking on a boundary this far into the chunk before splitting mid-word. */
const MIN_SPLIT_RATIO = 0.6

/**
 * Splits text into pieces the TTS relay will accept.
 *
 * The caller sentence-splits on Western `.!?` only, so text that never matches
 * — CJK punctuation, or a list with no terminal punctuation — reaches this hook
 * as one accumulated block that can exceed the relay's per-request cap. Without
 * splitting, the relay rejects it and the whole message plays no audio.
 */
export function splitForSynthesis(text: string, max: number = MAX_TTS_TEXT_LENGTH): string[] {
  if (text.length <= max) return [text]

  const chunks: string[] = []
  let rest = text

  while (rest.length > max) {
    const window = rest.slice(0, max)
    const boundary = Math.max(
      window.lastIndexOf(' '),
      window.lastIndexOf('\n'),
      window.lastIndexOf('。'),
      window.lastIndexOf('，'),
      window.lastIndexOf('、')
    )
    const cut = boundary >= max * MIN_SPLIT_RATIO ? boundary + 1 : max
    const piece = rest.slice(0, cut).trim()
    if (piece) chunks.push(piece)
    rest = rest.slice(cut)
  }

  const tail = rest.trim()
  if (tail) chunks.push(tail)
  return chunks
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

interface AudioStreamingOptions {
  voiceId: string
  modelId?: string
  chatId: string
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
    const {
      voiceId,
      modelId = DEFAULT_TTS_MODEL_ID,
      chatId,
      onAudioStart,
      onAudioEnd,
      onError,
    } = options

    try {
      const audioContext = getAudioContext()

      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }
      // boundary-raw-fetch: TTS proxy returns raw audio bytes consumed via response.arrayBuffer() and decoded by AudioContext.decodeAudioData
      const response = await fetch('/api/proxy/tts/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voiceId,
          modelId,
          chatId,
        }),
        signal: abortControllerRef.current?.signal,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(errorText || `TTS request failed: ${response.statusText}`)
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

      for (const piece of splitForSynthesis(text)) {
        audioQueueRef.current.push({ text: piece, options })
      }
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
