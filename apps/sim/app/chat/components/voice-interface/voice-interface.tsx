'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Mic, MicOff, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/core/utils/cn'
import { ParticlesVisualization } from '@/app/chat/components/voice-interface/components/particles'

const logger = createLogger('VoiceInterface')

interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message?: string
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null
  onend: ((this: SpeechRecognition, ev: Event) => any) | null
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null
}

interface SpeechRecognitionStatic {
  new (): SpeechRecognition
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionStatic
    webkitSpeechRecognition?: SpeechRecognitionStatic
  }
}

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
}: VoiceInterfaceProps) {
  const [state, setState] = useState<'idle' | 'listening' | 'agent_speaking'>('idle')
  const [isInitialized, setIsInitialized] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(200).fill(0))
  const [permissionStatus, setPermissionStatus] = useState<'prompt' | 'granted' | 'denied'>(
    'prompt'
  )
  const [currentTranscript, setCurrentTranscript] = useState('')

  const currentStateRef = useRef<'idle' | 'listening' | 'agent_speaking'>('idle')
  const isCallEndedRef = useRef(false)

  useEffect(() => {
    currentStateRef.current = state
  }, [state])

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const isMutedRef = useRef(false)
  const responseTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const isSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  const setResponseTimeout = useCallback(() => {
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
    }

    responseTimeoutRef.current = setTimeout(() => {
      if (currentStateRef.current === 'listening') {
        setState('idle')
      }
    }, 5000)
  }, [])

  const clearResponseTimeout = useCallback(() => {
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (isPlayingAudio && state !== 'agent_speaking') {
      clearResponseTimeout()
      setState('agent_speaking')
      setCurrentTranscript('')

      setIsMuted(true)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
      }

      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch (error) {
          logger.debug('Error aborting speech recognition:', error)
        }
      }
    } else if (!isPlayingAudio && state === 'agent_speaking') {
      setState('idle')
      setCurrentTranscript('')

      setIsMuted(false)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }
    }
  }, [isPlayingAudio, state, clearResponseTimeout])

  const setupAudio = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })

      setPermissionStatus('granted')
      mediaStreamRef.current = stream

      if (!audioContextRef.current) {
        const AudioContext = window.AudioContext || window.webkitAudioContext
        audioContextRef.current = new AudioContext()
      }

      const audioContext = audioContextRef.current
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8

      source.connect(analyser)
      analyserRef.current = analyser

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
      setIsInitialized(true)
      return true
    } catch (error) {
      logger.error('Error setting up audio:', error)
      setPermissionStatus('denied')
      return false
    }
  }, [])

  const setupSpeechRecognition = useCallback(() => {
    if (!isSupported) return

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {}

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const currentState = currentStateRef.current

      if (isMutedRef.current || currentState !== 'listening') {
        return
      }

      let finalTranscript = ''
      let interimTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript

        if (result.isFinal) {
          finalTranscript += transcript
        } else {
          interimTranscript += transcript
        }
      }

      setCurrentTranscript(interimTranscript || finalTranscript)

      if (finalTranscript.trim()) {
        setCurrentTranscript('')

        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop()
          } catch (error) {
            // Ignore
          }
        }

        setResponseTimeout()

        onVoiceTranscript?.(finalTranscript)
      }
    }

    recognition.onend = () => {
      if (isCallEndedRef.current) return

      const currentState = currentStateRef.current

      if (currentState === 'listening' && !isMutedRef.current) {
        setTimeout(() => {
          if (isCallEndedRef.current) return

          if (
            recognitionRef.current &&
            currentStateRef.current === 'listening' &&
            !isMutedRef.current
          ) {
            try {
              recognitionRef.current.start()
            } catch (error) {
              logger.debug('Error restarting speech recognition:', error)
            }
          }
        }, 1000)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'aborted') {
        return
      }

      if (event.error === 'not-allowed') {
        setPermissionStatus('denied')
      }
    }

    recognitionRef.current = recognition
  }, [isSupported, onVoiceTranscript, setResponseTimeout])

  const startListening = useCallback(() => {
    if (!isInitialized || isMuted || state !== 'idle') {
      return
    }

    setState('listening')
    setCurrentTranscript('')

    if (recognitionRef.current) {
      try {
        recognitionRef.current.start()
      } catch (error) {
        logger.error('Error starting recognition:', error)
      }
    }
  }, [isInitialized, isMuted, state])

  const stopListening = useCallback(() => {
    setState('idle')
    setCurrentTranscript('')

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (error) {
        // Ignore
      }
    }
  }, [])

  const handleInterrupt = useCallback(() => {
    if (state === 'agent_speaking') {
      onInterrupt?.()
      setState('listening')
      setCurrentTranscript('')

      setIsMuted(false)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }

      if (recognitionRef.current) {
        try {
          recognitionRef.current.start()
        } catch (error) {
          logger.error('Could not start recognition after interrupt:', error)
        }
      }
    }
  }, [state, onInterrupt])

  const handleCallEnd = useCallback(() => {
    isCallEndedRef.current = true

    setState('idle')
    setCurrentTranscript('')
    setIsMuted(false)

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch (error) {
        logger.error('Error stopping speech recognition:', error)
      }
    }

    clearResponseTimeout()
    onInterrupt?.()
    onCallEnd?.()
  }, [onCallEnd, onInterrupt, clearResponseTimeout])

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
    setIsMuted(newMutedState)

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
  }, [isMuted, state, handleInterrupt, stopListening, startListening])

  useEffect(() => {
    if (isSupported) {
      setupSpeechRecognition()
      setupAudio()
    }
  }, [isSupported, setupSpeechRecognition, setupAudio])

  useEffect(() => {
    if (isInitialized && !isMuted && state === 'idle') {
      startListening()
    }
  }, [isInitialized, isMuted, state, startListening])

  useEffect(() => {
    return () => {
      isCallEndedRef.current = true

      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch (_e) {
          // Ignore
        }
        recognitionRef.current = null
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

      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current)
        responseTimeoutRef.current = null
      }
    }
  }, [])

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
    <div className={cn('fixed inset-0 z-[100] flex flex-col bg-white text-gray-900', className)}>
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
              <p className='overflow-hidden text-center text-gray-700 text-xl leading-relaxed'>
                {currentTranscript}
              </p>
            </div>
          )}
        </div>

        <p className='mb-8 text-center text-gray-600 text-lg'>
          {getStatusText()}
          {isMuted && <span className='ml-2 text-gray-400 text-sm'>(Muted)</span>}
        </p>
      </div>

      <div className='px-8 pb-12'>
        <div className='flex items-center justify-center space-x-12'>
          <Button
            onClick={handleCallEnd}
            variant='outline'
            size='icon'
            className='h-14 w-14 rounded-full border-gray-300 hover:bg-gray-50'
          >
            <Phone className='h-6 w-6 rotate-[135deg]' />
          </Button>

          <Button
            onClick={toggleMute}
            variant='outline'
            size='icon'
            disabled={!isInitialized}
            className={cn(
              'h-14 w-14 rounded-full border-gray-300 bg-transparent hover:bg-gray-50',
              isMuted ? 'text-gray-400' : 'text-gray-600'
            )}
          >
            {getButtonContent()}
          </Button>
        </div>
      </div>
    </div>
  )
}
