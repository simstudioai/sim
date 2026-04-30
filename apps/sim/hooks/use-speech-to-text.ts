'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { getVoiceSettingsContract } from '@/lib/api/contracts/common'
import { speechTokenContract } from '@/lib/api/contracts/media-tools'
import { arrayBufferToBase64, floatTo16BitPCM } from '@/lib/speech/audio'
import {
  CHUNK_SEND_INTERVAL_MS,
  ELEVENLABS_WS_URL,
  MAX_SESSION_MS,
  SAMPLE_RATE,
} from '@/lib/speech/config'

const logger = createLogger('useSpeechToText')

export { MAX_SESSION_MS } from '@/lib/speech/config'

export type PermissionState = 'prompt' | 'granted' | 'denied'

interface UseSpeechToTextProps {
  onTranscript: (text: string) => void
  onUsageLimitExceeded?: () => void
  language?: string
}

interface UseSpeechToTextReturn {
  isListening: boolean
  isSupported: boolean
  permissionState: PermissionState
  toggleListening: () => void
  resetTranscript: () => void
}

export function useSpeechToText({
  onTranscript,
  onUsageLimitExceeded,
  language,
}: UseSpeechToTextProps): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const [permissionState, setPermissionState] = useState<PermissionState>('prompt')

  const onTranscriptRef = useRef(onTranscript)
  const onUsageLimitExceededRef = useRef(onUsageLimitExceeded)
  const languageRef = useRef(language)
  const mountedRef = useRef(true)
  const startingRef = useRef(false)

  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const pcmBufferRef = useRef<Float32Array[]>([])
  const sendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopStreamingRef = useRef<() => void>(() => {})
  const isFirstChunkRef = useRef(true)
  const committedTextRef = useRef('')

  onTranscriptRef.current = onTranscript
  onUsageLimitExceededRef.current = onUsageLimitExceeded
  languageRef.current = language

  useEffect(() => {
    const browserOk =
      typeof window !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      typeof WebSocket !== 'undefined' &&
      typeof navigator?.mediaDevices?.getUserMedia === 'function'

    if (!browserOk) {
      setIsSupported(false)
      return
    }

    requestJson(getVoiceSettingsContract, {})
      .then((data) => {
        if (mountedRef.current) setIsSupported(data.sttAvailable === true)
      })
      .catch(() => {
        if (mountedRef.current) setIsSupported(false)
      })
  }, [])

  const flushAudioBuffer = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const chunks = pcmBufferRef.current
    if (chunks.length === 0) return
    pcmBufferRef.current = []

    let totalLength = 0
    for (const chunk of chunks) totalLength += chunk.length
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    const pcm16 = floatTo16BitPCM(merged)
    const message: Record<string, unknown> = {
      message_type: 'input_audio_chunk',
      audio_base_64: arrayBufferToBase64(pcm16),
      sample_rate: SAMPLE_RATE,
      commit: false,
    }

    if (isFirstChunkRef.current) {
      isFirstChunkRef.current = false
      if (committedTextRef.current) {
        message.previous_text = committedTextRef.current
      }
    }

    ws.send(JSON.stringify(message))
  }, [])

  const cleanup = useCallback(() => {
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current)
      sessionTimerRef.current = null
    }

    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current)
      sendIntervalRef.current = null
    }

    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (wsRef.current) {
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close()
      }
      wsRef.current = null
    }

    pcmBufferRef.current = []
    isFirstChunkRef.current = true
  }, [])

  const startStreaming = useCallback(async () => {
    if (startingRef.current) return false
    startingRef.current = true

    try {
      let tokenData: Awaited<ReturnType<typeof requestJson<typeof speechTokenContract>>>
      try {
        tokenData = await requestJson(speechTokenContract, { body: {} })
      } catch (err) {
        if (isApiClientError(err) && err.status === 402) {
          onUsageLimitExceededRef.current?.()
          return false
        }
        throw err instanceof Error ? err : new Error('Failed to get speech token')
      }

      const token = typeof tokenData.token === 'string' ? tokenData.token : undefined
      if (!token) throw new Error('Failed to get speech token')
      if (!mountedRef.current) return false

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
        },
      })

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return false
      }

      setPermissionState('granted')
      streamRef.current = stream

      const params = new URLSearchParams({
        token,
        model_id: 'scribe_v2_realtime',
        audio_format: 'pcm_16000',
        commit_strategy: 'vad',
        vad_silence_threshold_secs: '1.0',
      })
      if (languageRef.current) {
        params.set('language_code', languageRef.current)
      }

      const ws = new WebSocket(`${ELEVENLABS_WS_URL}?${params.toString()}`)
      wsRef.current = ws
      committedTextRef.current = ''
      isFirstChunkRef.current = true

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('WebSocket connection failed'))

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data)

            if (msg.message_type === 'partial_transcript' && msg.text) {
              if (mountedRef.current) {
                const full = committedTextRef.current
                  ? `${committedTextRef.current} ${msg.text}`
                  : msg.text
                onTranscriptRef.current(full)
              }
            } else if (
              (msg.message_type === 'committed_transcript' ||
                msg.message_type === 'committed_transcript_with_timestamps') &&
              msg.text
            ) {
              committedTextRef.current = committedTextRef.current
                ? `${committedTextRef.current} ${msg.text}`
                : msg.text
              if (mountedRef.current) {
                onTranscriptRef.current(committedTextRef.current)
              }
            } else if (
              msg.message_type === 'error' ||
              msg.message_type === 'auth_error' ||
              msg.message_type === 'quota_exceeded'
            ) {
              logger.error('ElevenLabs STT error', { type: msg.message_type, error: msg.error })
            }
          } catch {
            // Ignore non-JSON messages
          }
        }

        ws.onclose = () => {
          if (mountedRef.current) {
            setIsListening(false)
          }
          cleanup()
        }
      })

      if (!mountedRef.current) {
        ws.close()
        stream.getTracks().forEach((track) => track.stop())
        return false
      }

      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        pcmBufferRef.current.push(new Float32Array(input))
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      sendIntervalRef.current = setInterval(flushAudioBuffer, CHUNK_SEND_INTERVAL_MS)

      setIsListening(true)

      sessionTimerRef.current = setTimeout(() => {
        logger.info('Voice input session reached max duration, stopping')
        stopStreamingRef.current()
      }, MAX_SESSION_MS)

      return true
    } catch (error) {
      logger.error('Failed to start speech streaming', error)
      cleanup()
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setPermissionState('denied')
      }
      return false
    } finally {
      startingRef.current = false
    }
  }, [cleanup, flushAudioBuffer])

  const stopStreaming = useCallback(() => {
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current)
      sessionTimerRef.current = null
    }

    flushAudioBuffer()

    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: '',
          sample_rate: SAMPLE_RATE,
          commit: true,
        })
      )
    }

    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current)
      sendIntervalRef.current = null
    }

    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    const wsToClose = wsRef.current
    wsRef.current = null
    if (wsToClose) {
      setTimeout(() => {
        if (
          wsToClose.readyState === WebSocket.OPEN ||
          wsToClose.readyState === WebSocket.CONNECTING
        ) {
          wsToClose.close()
        }
      }, 2000)
    }

    setIsListening(false)
  }, [flushAudioBuffer])

  stopStreamingRef.current = stopStreaming

  const resetTranscript = useCallback(() => {
    committedTextRef.current = ''
    isFirstChunkRef.current = true
  }, [])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopStreaming()
    } else {
      startStreaming()
    }
  }, [isListening, startStreaming, stopStreaming])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cleanup()
    }
  }, [cleanup])

  return {
    isListening,
    isSupported,
    permissionState,
    toggleListening,
    resetTranscript,
  }
}
