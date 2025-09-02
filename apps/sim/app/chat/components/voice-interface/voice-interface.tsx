'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
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
  // Simple state machine
  const [state, setState] = useState<'idle' | 'listening' | 'agent_speaking'>('idle')
  const [isInitialized, setIsInitialized] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(200).fill(0))
  const [permissionStatus, setPermissionStatus] = useState<'prompt' | 'granted' | 'denied'>(
    'prompt'
  )

  // Current turn transcript (subtitle)
  const [currentTranscript, setCurrentTranscript] = useState('')

  // State tracking
  const currentStateRef = useRef<'idle' | 'listening' | 'agent_speaking'>('idle')

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

  // Update muted ref
  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  // Timeout to handle cases where agent doesn't provide audio response
  const setResponseTimeout = useCallback(() => {
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
    }

    responseTimeoutRef.current = setTimeout(() => {
      if (currentStateRef.current === 'listening') {
        setState('idle')
      }
    }, 5000) // 5 second timeout (increased from 3)
  }, [])

  const clearResponseTimeout = useCallback(() => {
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = null
    }
  }, [])

  // Sync with external state
  useEffect(() => {
    if (isPlayingAudio && state !== 'agent_speaking') {
      clearResponseTimeout() // Clear timeout since agent is responding
      setState('agent_speaking')
      setCurrentTranscript('')

      // Mute microphone immediately
      setIsMuted(true)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
      }

      // Stop speech recognition completely
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

      // Re-enable microphone
      setIsMuted(false)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }
    }
  }, [isPlayingAudio, state, clearResponseTimeout])

  // Audio setup
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

      // Setup audio context for visualization
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

      // Start visualization
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

  // Speech recognition setup
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

      // Update live transcript
      setCurrentTranscript(interimTranscript || finalTranscript)

      // Send final transcript (but keep listening state until agent responds)
      if (finalTranscript.trim()) {
        setCurrentTranscript('') // Clear transcript

        // Stop recognition to avoid interference while waiting for response
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop()
          } catch (error) {
            // Ignore
          }
        }

        // Start timeout in case agent doesn't provide audio response
        setResponseTimeout()

        onVoiceTranscript?.(finalTranscript)
      }
    }

    recognition.onend = () => {
      const currentState = currentStateRef.current

      // Only restart recognition if we're in listening state and not muted
      if (currentState === 'listening' && !isMutedRef.current) {
        // Add a delay to avoid immediate restart after sending transcript
        setTimeout(() => {
          // Double-check state hasn't changed during delay
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
        }, 1000) // Longer delay to give agent time to respond
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Filter out "aborted" errors - these are expected when we intentionally stop recognition
      if (event.error === 'aborted') {
        // Ignore
        return
      }

      if (event.error === 'not-allowed') {
        setPermissionStatus('denied')
      }
    }

    recognitionRef.current = recognition
  }, [isSupported, onVoiceTranscript, setResponseTimeout])

  // Start/stop listening
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

  // Handle interrupt
  const handleInterrupt = useCallback(() => {
    if (state === 'agent_speaking') {
      // Clear any subtitle timeouts and text
      // (No longer needed after removing subtitle system)

      onInterrupt?.()
      setState('listening')
      setCurrentTranscript('')

      // Unmute microphone for user input
      setIsMuted(false)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }

      // Start listening immediately
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start()
        } catch (error) {
          logger.error('Could not start recognition after interrupt:', error)
        }
      }
    }
  }, [state, onInterrupt])

  // Handle call end with proper cleanup
  const handleCallEnd = useCallback(() => {
    // Stop everything immediately
    setState('idle')
    setCurrentTranscript('')
    setIsMuted(false)

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort()
      } catch (error) {
        logger.error('Error stopping speech recognition:', error)
      }
    }

    // Clear timeouts
    clearResponseTimeout()

    // Stop audio playback and streaming immediately
    onInterrupt?.()

    // Call the original onCallEnd
    onCallEnd?.()
  }, [onCallEnd, onInterrupt, clearResponseTimeout])

  // Keyboard handler
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

  // Mute toggle
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

  // Initialize
  useEffect(() => {
    if (isSupported) {
      setupSpeechRecognition()
      setupAudio()
    }
  }, [isSupported, setupSpeechRecognition, setupAudio])

  // Auto-start listening when ready
  useEffect(() => {
    if (isInitialized && !isMuted && state === 'idle') {
      startListening()
    }
  }, [isInitialized, isMuted, state, startListening])

  // Cleanup when call ends or component unmounts
  useEffect(() => {
    return () => {
      // Stop speech recognition
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch (error) {
          // Ignore
        }
        recognitionRef.current = null
      }

      // Stop media stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => {
          track.stop()
        })
        mediaStreamRef.current = null
      }

      // Stop audio context
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }

      // Cancel animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      // Clear timeouts
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current)
        responseTimeoutRef.current = null
      }
    }
  }, [])

  // Get status text
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

  // Get button content
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
      {/* Main content */}
      <div className='flex flex-1 flex-col items-center justify-center px-8'>
        {/* Voice visualization */}
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

        {/* Live transcript - subtitle style */}
        <div className='mb-16 flex h-24 items-center justify-center'>
          {currentTranscript && (
            <div className='max-w-2xl px-8'>
              <p className='overflow-hidden text-center text-gray-700 text-xl leading-relaxed'>
                {currentTranscript}
              </p>
            </div>
          )}
        </div>

        {/* Status */}
        <p className='mb-8 text-center text-gray-600 text-lg'>
          {getStatusText()}
          {isMuted && <span className='ml-2 text-gray-400 text-sm'>(Muted)</span>}
        </p>
      </div>

      {/* Controls */}
      <div className='px-8 pb-12'>
        <div className='flex items-center justify-center space-x-12'>
          {/* End call */}
          <Button
            onClick={handleCallEnd}
            variant='outline'
            size='icon'
            className='h-14 w-14 rounded-full border-gray-300 hover:bg-gray-50'
          >
            <Phone className='h-6 w-6 rotate-[135deg]' />
          </Button>

          {/* Mic/Stop button */}
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
