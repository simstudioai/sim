'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Mic, MicOff, Phone } from 'lucide-react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { requestJson } from '@/lib/api/client/request'
import { speechTokenContract } from '@/lib/api/contracts/media-tools'
import { cn } from '@/lib/core/utils/cn'
import { arrayBufferToBase64, floatTo16BitPCM } from '@/lib/speech/audio'
import {
  CHUNK_SEND_INTERVAL_MS,
  ELEVENLABS_WS_URL,
  MAX_CHAT_SESSION_MS,
  SAMPLE_RATE,
} from '@/lib/speech/config'

const ParticlesVisualization = dynamic(
  () =>
    import('@/app/chat/components/voice-interface/components/particles').then(
      (mod) => mod.ParticlesVisualization
    ),
  { ssr: false }
)

const logger = createLogger('VoiceInterface')

interface VoiceInterfaceProps {
  onCallEnd?: () => void
  onVoiceTranscript?: (transcript: string) => void
  onVoiceStart?: () => void
  onVoiceEnd?: () => void
  onInterrupt?: () => void
  isStreaming?: boolean
  isPlayingAudio?: boolean
  audioContextRef?: RefObject<AudioContext | null>
  messages?: Array<{ content: string; type: 'user' | 'assistant' }>
  className?: string
  chatId?: string
}

export function VoiceInterface({
  onCallEnd,
  onVoiceTranscript,
  onVoiceStart,
  onVoiceEnd,
  onInterrupt,
  isStreaming = false,
  isPlayingAudio = false,
  audioContextRef: sharedAudioContextRef,
  messages = [],
  className,
  chatId,
}: VoiceInterfaceProps) {
  const [state, setState] = useState<'idle' | 'listening' | 'agent_speaking'>('idle')
  const [isInitialized, setIsInitialized] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevels, setAudioLevels] = useState<number[]>(() => new Array(200).fill(0))
  const [permissionStatus, setPermissionStatus] = useState<'prompt' | 'granted' | 'denied'>(
    'prompt'
  )
  const [currentTranscript, setCurrentTranscript] = useState('')

  const currentStateRef = useRef<'idle' | 'listening' | 'agent_speaking'>('idle')
  const isCallEndedRef = useRef(false)

  const updateState = useCallback((next: 'idle' | 'listening' | 'agent_speaking') => {
    setState(next)
    currentStateRef.current = next
  }, [])

  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const isMutedRef = useRef(false)

  const wsRef = useRef<WebSocket | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const pcmBufferRef = useRef<Float32Array[]>([])
  const sendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const committedTextRef = useRef('')
  const lastPartialRef = useRef('')
  const onVoiceTranscriptRef = useRef(onVoiceTranscript)

  onVoiceTranscriptRef.current = onVoiceTranscript

  const updateIsMuted = useCallback((next: boolean) => {
    setIsMuted(next)
    isMutedRef.current = next
  }, [])

  const stopSendingAudio = useCallback(() => {
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current)
      sessionTimerRef.current = null
    }
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current)
      sendIntervalRef.current = null
    }
    pcmBufferRef.current = []
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

    ws.send(
      JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: arrayBufferToBase64(pcm16),
        sample_rate: SAMPLE_RATE,
        commit: false,
      })
    )
  }, [])

  const startSendingAudio = useCallback(() => {
    if (sendIntervalRef.current) return
    pcmBufferRef.current = []
    sendIntervalRef.current = setInterval(flushAudioBuffer, CHUNK_SEND_INTERVAL_MS)
  }, [flushAudioBuffer])

  const closeWebSocket = useCallback(() => {
    stopSendingAudio()
    if (wsRef.current) {
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close()
      }
      wsRef.current = null
    }
  }, [stopSendingAudio])

  const connectWebSocket = useCallback(async (): Promise<boolean> => {
    try {
      let tokenData: Awaited<ReturnType<typeof requestJson<typeof speechTokenContract>>>
      try {
        tokenData = await requestJson(speechTokenContract, {
          body: chatId ? { chatId } : {},
        })
      } catch (err) {
        logger.error('Failed to get STT token', err)
        return false
      }

      const token = typeof tokenData.token === 'string' ? tokenData.token : undefined
      if (!token) {
        logger.error('STT token missing from response')
        return false
      }

      const params = new URLSearchParams({
        token,
        model_id: 'scribe_v2_realtime',
        audio_format: 'pcm_16000',
        commit_strategy: 'vad',
        vad_silence_threshold_secs: '1.0',
      })

      const ws = new WebSocket(`${ELEVENLABS_WS_URL}?${params.toString()}`)
      wsRef.current = ws
      committedTextRef.current = ''

      return new Promise<boolean>((resolve) => {
        ws.onopen = () => resolve(true)
        ws.onerror = () => {
          logger.error('STT WebSocket connection error')
          resolve(false)
        }

        ws.onmessage = (event) => {
          if (isCallEndedRef.current) return

          try {
            const msg = JSON.parse(event.data)

            if (msg.message_type === 'partial_transcript') {
              if (msg.text) {
                lastPartialRef.current = msg.text
                setCurrentTranscript(msg.text)
              }
            } else if (
              msg.message_type === 'committed_transcript' ||
              msg.message_type === 'committed_transcript_with_timestamps'
            ) {
              const finalText = msg.text || lastPartialRef.current
              lastPartialRef.current = ''
              if (finalText) {
                committedTextRef.current = committedTextRef.current
                  ? `${committedTextRef.current} ${finalText}`
                  : finalText
                setCurrentTranscript('')
                onVoiceTranscriptRef.current?.(finalText)
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
          wsRef.current = null
          if (currentStateRef.current === 'listening' && !isCallEndedRef.current) {
            stopSendingAudio()
            updateState('idle')
          }
        }
      })
    } catch (error) {
      logger.error('Failed to connect STT WebSocket', error)
      return false
    }
  }, [chatId])

  const setupAudioPipeline = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
        },
      })

      setPermissionStatus('granted')
      mediaStreamRef.current = stream

      const ac = new AudioContext({ sampleRate: SAMPLE_RATE })
      audioContextRef.current = ac

      if (ac.state === 'suspended') {
        await ac.resume()
      }

      const source = ac.createMediaStreamSource(stream)

      const analyser = ac.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      analyserRef.current = analyser

      const processor = ac.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (e) => {
        if (!isMutedRef.current && currentStateRef.current === 'listening') {
          pcmBufferRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
        }
      }
      source.connect(processor)
      processor.connect(ac.destination)
      processorRef.current = processor

      const updateVisualization = () => {
        if (!analyserRef.current) return
        const bufferLength = analyserRef.current.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        analyserRef.current.getByteFrequencyData(dataArray)

        const levels = []
        for (let i = 0; i < 200; i++) {
          const dataIndex = Math.floor((i / 200) * bufferLength)
          const value = dataArray[dataIndex] || 0
          levels.push((value / 255) * 100)
        }

        setAudioLevels(levels)
        animationFrameRef.current = requestAnimationFrame(updateVisualization)
      }
      updateVisualization()

      return true
    } catch (error) {
      logger.error('Error setting up audio pipeline:', error)
      setPermissionStatus('denied')
      return false
    }
  }, [])

  const startListening = useCallback(async () => {
    if (currentStateRef.current !== 'idle' || isMutedRef.current || isCallEndedRef.current) return

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      const connected = await connectWebSocket()
      if (!connected || isCallEndedRef.current) return
    }

    updateState('listening')
    setCurrentTranscript('')
    startSendingAudio()

    sessionTimerRef.current = setTimeout(() => {
      logger.info('Voice session reached max duration, stopping')
      stopSendingAudio()
      closeWebSocket()
      updateState('idle')
    }, MAX_CHAT_SESSION_MS)
  }, [connectWebSocket, updateState, startSendingAudio, stopSendingAudio, closeWebSocket])

  const stopListening = useCallback(() => {
    stopSendingAudio()
    updateState('idle')
    setCurrentTranscript('')
  }, [updateState, stopSendingAudio])

  useEffect(() => {
    if (isPlayingAudio && state === 'listening') {
      stopSendingAudio()
      closeWebSocket()
      updateState('agent_speaking')
      setCurrentTranscript('')

      updateIsMuted(true)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
      }
    } else if (!isPlayingAudio && state === 'agent_speaking') {
      updateState('idle')
      setCurrentTranscript('')

      updateIsMuted(false)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }
    }
  }, [isPlayingAudio, state, updateState, updateIsMuted, stopSendingAudio, closeWebSocket])

  const handleInterrupt = useCallback(() => {
    if (state === 'agent_speaking') {
      onInterrupt?.()

      updateIsMuted(false)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }

      updateState('idle')
      setCurrentTranscript('')
    }
  }, [state, onInterrupt, updateState, updateIsMuted])

  const handleCallEnd = useCallback(() => {
    isCallEndedRef.current = true

    stopSendingAudio()
    closeWebSocket()
    updateState('idle')
    setCurrentTranscript('')
    updateIsMuted(false)

    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    onInterrupt?.()
    onCallEnd?.()
  }, [onCallEnd, onInterrupt, updateState, updateIsMuted, stopSendingAudio, closeWebSocket])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault()
        handleInterrupt()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleInterrupt])

  const toggleMute = useCallback(() => {
    if (state === 'agent_speaking') {
      handleInterrupt()
      return
    }

    const newMutedState = !isMuted
    updateIsMuted(newMutedState)

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !newMutedState
      })
    }

    if (newMutedState) {
      stopListening()
    } else if (state === 'idle') {
      startListening()
    }
  }, [isMuted, state, handleInterrupt, stopListening, startListening, updateIsMuted])

  useEffect(() => {
    isCallEndedRef.current = false
    let cancelled = false

    async function init() {
      const audioOk = await setupAudioPipeline()
      if (!audioOk || cancelled) return

      const wsOk = await connectWebSocket()
      if (!wsOk || cancelled) return

      setIsInitialized(true)
    }

    init()

    return () => {
      cancelled = true
    }
  }, [setupAudioPipeline, connectWebSocket])

  useEffect(() => {
    if (isInitialized && !isMuted && state === 'idle') {
      startListening()
    }
  }, [isInitialized, isMuted, state, startListening])

  useEffect(() => {
    return () => {
      isCallEndedRef.current = true

      stopSendingAudio()

      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      if (processorRef.current) {
        processorRef.current.disconnect()
        processorRef.current = null
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
      }

      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [stopSendingAudio])

  const getStatusText = () => {
    switch (state) {
      case 'listening':
        return 'Listening...'
      case 'agent_speaking':
        return 'Press Space or tap to interrupt'
      default:
        return isInitialized ? 'Ready' : 'Initializing...'
    }
  }

  const getButtonContent = () => {
    if (state === 'agent_speaking') {
      return (
        <svg className='h-6 w-6' viewBox='0 0 24 24' fill='currentColor'>
          <rect x='6' y='6' width='12' height='12' rx='2' />
        </svg>
      )
    }
    return isMuted ? <MicOff className='h-6 w-6' /> : <Mic className='h-6 w-6' />
  }

  return (
    <div
      className={cn(
        'dark fixed inset-0 z-[100] flex flex-col bg-[var(--landing-bg)] text-[var(--landing-text)]',
        className
      )}
    >
      <div className='flex flex-1 flex-col items-center justify-center px-8'>
        <div className='relative mb-16'>
          <ParticlesVisualization
            audioLevels={audioLevels}
            isListening={state === 'listening'}
            isPlayingAudio={state === 'agent_speaking'}
            isStreaming={isStreaming}
            isMuted={isMuted}
            className='h-80 w-80 md:h-96 md:w-96'
          />
        </div>

        <div className='mb-16 flex h-24 items-center justify-center'>
          {currentTranscript && (
            <div className='max-w-2xl px-8'>
              <p className='overflow-hidden text-center text-[var(--landing-text)] text-xl leading-relaxed'>
                {currentTranscript}
              </p>
            </div>
          )}
        </div>

        <p className='mb-8 text-center text-[var(--landing-text-muted)] text-lg'>
          {getStatusText()}
          {isMuted && (
            <span className='ml-2 text-[var(--landing-text-muted)] text-sm'>(Muted)</span>
          )}
        </p>
      </div>

      <div className='px-8 pb-12'>
        <div className='flex items-center justify-center space-x-12'>
          <Button
            onClick={handleCallEnd}
            variant='outline'
            size='icon'
            className='h-14 w-14 rounded-full border-[var(--border-1)] hover:bg-[var(--landing-bg-elevated)]'
          >
            <Phone className='h-6 w-6 rotate-[135deg]' />
          </Button>

          <Button
            onClick={toggleMute}
            variant='outline'
            size='icon'
            disabled={!isInitialized}
            className={cn(
              'h-14 w-14 rounded-full border-[var(--border-1)] bg-transparent hover:bg-[var(--landing-bg-elevated)]',
              isMuted ? 'text-[var(--landing-text-muted)]' : 'text-[var(--landing-text)]'
            )}
          >
            {getButtonContent()}
          </Button>
        </div>
      </div>
    </div>
  )
}
