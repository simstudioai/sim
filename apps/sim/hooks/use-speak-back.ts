'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'

const logger = createLogger('useSpeakBack')

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

interface UseSpeakBackReturn {
  /** True when audio playback is possible (Web Audio present). */
  isSupported: boolean
  /** True while a clip is playing or queued. */
  isSpeaking: boolean
  /** Speak text aloud via ElevenLabs streaming TTS. Queued after any current clip. */
  speak: (text: string) => void
  /** Stop playback and clear the queue. */
  cancel: () => void
}

/**
 * Reads assistant replies aloud using ElevenLabs streaming TTS — the same
 * natural-voice pipeline as deployed chat's voice mode, through the
 * session-authed `/api/speech/tts` route. Text is queued and played
 * sequentially (feed it a sentence at a time for conversational, low-latency
 * read-back). No OS speech-synthesis fallback: ElevenLabs is the voice.
 */
export function useSpeakBack(): UseSpeakBackReturn {
  const [isSupported, setIsSupported] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)

  const audioContextRef = useRef<AudioContext | null>(null)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const queueRef = useRef<string[]>([])
  const processingRef = useRef(false)
  const generationRef = useRef(0)

  useEffect(() => {
    setIsSupported(
      typeof window !== 'undefined' &&
        (typeof AudioContext !== 'undefined' || typeof window.webkitAudioContext !== 'undefined')
    )
    return () => {
      // Tear down on unmount.
      generationRef.current += 1
      abortRef.current?.abort()
      currentSourceRef.current?.stop()
      currentSourceRef.current = null
      queueRef.current = []
      processingRef.current = false
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {})
      }
      audioContextRef.current = null
    }
  }, [])

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const Ctor = window.AudioContext ?? window.webkitAudioContext
      if (!Ctor) throw new Error('AudioContext unavailable')
      audioContextRef.current = new Ctor()
    }
    return audioContextRef.current
  }, [])

  const cancel = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop()
      } catch {
        // already stopped
      }
      currentSourceRef.current = null
    }
    queueRef.current = []
    processingRef.current = false
    setIsSpeaking(false)
  }, [])

  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    const next = queueRef.current.shift()
    if (next === undefined) {
      setIsSpeaking(false)
      return
    }
    processingRef.current = true
    const generation = generationRef.current

    try {
      const audioContext = getAudioContext()
      if (audioContext.state === 'suspended') await audioContext.resume()

      abortRef.current = new AbortController()
      // boundary-raw-fetch: TTS route streams raw MP3 bytes consumed via arrayBuffer() + decodeAudioData
      const response = await fetch('/api/speech/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: next }),
        signal: abortRef.current.signal,
      })
      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      if (generation !== generationRef.current) return
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      if (generation !== generationRef.current) return

      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(audioContext.destination)
      source.onended = () => {
        if (generation !== generationRef.current) return
        currentSourceRef.current = null
        processingRef.current = false
        if (queueRef.current.length === 0) setIsSpeaking(false)
        void processQueue()
      }
      currentSourceRef.current = source
      setIsSpeaking(true)
      source.start(0)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        logger.warn('TTS playback failed', { error })
      }
      processingRef.current = false
      if (generation === generationRef.current) void processQueue()
    }
  }, [getAudioContext])

  const speak = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || !isSupported) return
      queueRef.current.push(trimmed)
      setIsSpeaking(true)
      void processQueue()
    },
    [isSupported, processQueue]
  )

  return { isSupported, isSpeaking, speak, cancel }
}

/**
 * Reduces streamed assistant text to plain spoken prose: drops inline special
 * tags (`<credential>`, `<options>`, `<thinking>`, …) and light markdown so
 * the synthesizer reads the message, not its markup.
 */
export function toSpeakableText(raw: string): string {
  return raw
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, ' ')
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ')
    .replace(/<[^>]+\/?>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Splits text into complete sentences plus a trailing incomplete remainder.
 * Used to feed the speaker sentence-by-sentence while a reply streams, so
 * playback starts almost immediately instead of after the whole message.
 */
export function splitCompleteSentences(text: string): { complete: string[]; rest: string } {
  const complete: string[] = []
  const regex = /[^.!?]*[.!?]+(?:["')\]]+)?\s/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((match = regex.exec(text)) !== null) {
    const sentence = match[0].trim()
    if (sentence) complete.push(sentence)
    lastIndex = regex.lastIndex
  }
  return { complete, rest: text.slice(lastIndex) }
}
