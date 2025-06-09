'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { ParticlesVisualization } from './components/particles'

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
  const [isListening, setIsListening] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(200).fill(0))
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>(
    'prompt'
  )
  const [isInitialized, setIsInitialized] = useState(false)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const localAudioContextRef = useRef<AudioContext | null>(null)
  const audioContextRef = sharedAudioContextRef || localAudioContextRef
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const isStartingRef = useRef(false)
  const isMutedRef = useRef(false)
  const compressorRef = useRef<DynamicsCompressorNode | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)

  const isSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (e) {
        // Ignore errors during cleanup
      }
      recognitionRef.current = null
    }

    analyserRef.current = null
    setAudioLevels(new Array(200).fill(0))
    setIsListening(false)
  }, [])

  const setupAudioVisualization = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 1,
          // Enhanced echo cancellation settings to prevent picking up speaker output
          suppressLocalAudioPlayback: true, // Modern browsers
          googEchoCancellation: true, // Chrome-specific
          googAutoGainControl: true,
          googNoiseSuppression: true,
          googHighpassFilter: true,
          googTypingNoiseDetection: true,
        } as any, // Type assertion for experimental properties
      })

      setPermissionStatus('granted')
      mediaStreamRef.current = stream

      if (!audioContextRef.current) {
        const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
        if (!AudioContextConstructor) {
          throw new Error('AudioContext is not supported in this browser')
        }
        audioContextRef.current = new AudioContextConstructor()
      }
      const audioContext = audioContextRef.current

      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      const source = audioContext.createMediaStreamSource(stream)

      const gainNode = audioContext.createGain()
      gainNode.gain.setValueAtTime(1, audioContext.currentTime)

      const compressor = audioContext.createDynamicsCompressor()
      compressor.threshold.setValueAtTime(-50, audioContext.currentTime)
      compressor.knee.setValueAtTime(40, audioContext.currentTime)
      compressor.ratio.setValueAtTime(12, audioContext.currentTime)
      compressor.attack.setValueAtTime(0, audioContext.currentTime)
      compressor.release.setValueAtTime(0.25, audioContext.currentTime)

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.5

      source.connect(gainNode)
      gainNode.connect(compressor)
      compressor.connect(analyser)

      audioContextRef.current = audioContext
      analyserRef.current = analyser
      compressorRef.current = compressor
      gainNodeRef.current = gainNode

      // Start visualization loop
      const updateVisualization = () => {
        if (!analyserRef.current) return

        if (isMutedRef.current) {
          setAudioLevels(new Array(200).fill(0))
          animationFrameRef.current = requestAnimationFrame(updateVisualization)
          return
        }

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
      logger.error('Error setting up audio:', error)
      setPermissionStatus('denied')
      return false
    }
  }, [isMuted])

  // Start listening
  const startListening = useCallback(async () => {
    if (
      !isSupported ||
      !recognitionRef.current ||
      isListening ||
      isMuted ||
      isStartingRef.current
    ) {
      return
    }

    try {
      isStartingRef.current = true

      if (!mediaStreamRef.current) {
        await setupAudioVisualization()
      }

      recognitionRef.current.start()
    } catch (error) {
      isStartingRef.current = false
      logger.error('Error starting voice input:', error)
      setIsListening(false)
    }
  }, [isSupported, isListening, setupAudioVisualization, isMuted])

  const initializeSpeechRecognition = useCallback(() => {
    if (!isSupported || recognitionRef.current) return

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      isStartingRef.current = false
      setIsListening(true)
      onVoiceStart?.()
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Don't process results if muted
      if (isMutedRef.current) {
        return
      }

      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript
        }
      }

      if (finalTranscript) {
        if (isPlayingAudio) {
          const cleanTranscript = finalTranscript.trim().toLowerCase()
          const isSubstantialSpeech = cleanTranscript.length >= 10
          const hasMultipleWords = cleanTranscript.split(/\s+/).length >= 3

          if (isSubstantialSpeech && hasMultipleWords) {
            onInterrupt?.()
            onVoiceTranscript?.(finalTranscript)
          }
        } else {
          onVoiceTranscript?.(finalTranscript)
        }
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      isStartingRef.current = false
      logger.error('Speech recognition error:', event.error)

      if (event.error === 'not-allowed') {
        setPermissionStatus('denied')
        setIsListening(false)
        onVoiceEnd?.()
        return
      }

      if (!isMutedRef.current && !isStartingRef.current) {
        setTimeout(() => {
          if (recognitionRef.current && !isMutedRef.current && !isStartingRef.current) {
            startListening()
          }
        }, 500)
      }
    }

    recognition.onend = () => {
      isStartingRef.current = false
      setIsListening(false)
      onVoiceEnd?.()

      if (!isMutedRef.current && !isStartingRef.current) {
        setTimeout(() => {
          if (recognitionRef.current && !isMutedRef.current && !isStartingRef.current) {
            startListening()
          }
        }, 200)
      }
    }

    recognitionRef.current = recognition
    setIsInitialized(true)
  }, [
    isSupported,
    isPlayingAudio,
    isMuted,
    onVoiceStart,
    onVoiceEnd,
    onVoiceTranscript,
    onInterrupt,
    startListening,
  ])

  const toggleMute = useCallback(() => {
    const newMutedState = !isMuted

    if (newMutedState) {
      isStartingRef.current = false

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch (e) {
          // Ignore errors
        }
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
      }

      setIsListening(false)
    } else {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }
      setTimeout(() => {
        if (!isMutedRef.current) {
          startListening()
        }
      }, 200)
    }

    setIsMuted(newMutedState)
  }, [isMuted, isListening, startListening])

  const handleEndCall = useCallback(() => {
    cleanup()
    onCallEnd?.()
  }, [cleanup, onCallEnd])

  const getStatusText = () => {
    if (isStreaming) return 'Thinking...'
    if (isPlayingAudio) return 'Speaking...'
    if (isListening) return 'Listening...'
    return 'Ready'
  }

  useEffect(() => {
    if (isSupported) {
      initializeSpeechRecognition()
    }
  }, [isSupported, initializeSpeechRecognition])

  useEffect(() => {
    if (isInitialized && !isMuted && !isListening) {
      const startAudio = async () => {
        try {
          if (!mediaStreamRef.current) {
            const success = await setupAudioVisualization()
            if (!success) {
              logger.error('Failed to setup audio visualization')
              return
            }
          }

          setTimeout(() => {
            if (!isListening && !isMuted && !isStartingRef.current) {
              startListening()
            }
          }, 300)
        } catch (error) {
          logger.error('Error setting up audio:', error)
        }
      }

      startAudio()
    }
  }, [isInitialized, isMuted, isListening, setupAudioVisualization, startListening])

  // Gain ducking during audio playback
  useEffect(() => {
    if (gainNodeRef.current && audioContextRef.current) {
      const gainNode = gainNodeRef.current
      const audioContext = audioContextRef.current

      if (isPlayingAudio) {
        gainNode.gain.setTargetAtTime(0.1, audioContext.currentTime, 0.1)
      } else {
        gainNode.gain.setTargetAtTime(1, audioContext.currentTime, 0.2)
      }
    }
  }, [isPlayingAudio])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return (
    <div className={cn('fixed inset-0 z-[100] flex flex-col bg-white text-gray-900', className)}>
      {/* Header with close button */}
      <div className='flex justify-end p-4'>
        <Button
          variant='ghost'
          size='icon'
          onClick={handleEndCall}
          className='h-10 w-10 rounded-full hover:bg-gray-100'
        >
          <X className='h-5 w-5' />
        </Button>
      </div>

      {/* Main content area */}
      <div className='flex flex-1 flex-col items-center justify-center px-8'>
        {/* Voice visualization */}
        <div className='relative mb-16'>
          <ParticlesVisualization
            audioLevels={audioLevels}
            isListening={isListening}
            isPlayingAudio={isPlayingAudio}
            isStreaming={isStreaming}
            isMuted={isMuted}
            isProcessingInterruption={false}
          />
        </div>

        {/* Status text */}
        <div className='mb-8 text-center'>
          <p className='font-light text-gray-600 text-lg'>
            {getStatusText()}
            {isMuted && <span className='ml-2 text-gray-400 text-sm'>(Muted)</span>}
          </p>
        </div>
      </div>

      {/* Bottom controls */}
      <div className='px-8 pb-12'>
        <div className='flex items-center justify-center space-x-12'>
          {/* End call button */}
          <Button
            onClick={handleEndCall}
            variant='outline'
            size='icon'
            className='h-14 w-14 rounded-full border-gray-300 hover:bg-gray-50'
          >
            <Phone className='h-6 w-6 rotate-[135deg]' />
          </Button>

          {/* Mute/unmute button */}
          <Button
            onClick={toggleMute}
            variant='outline'
            size='icon'
            className={cn(
              'h-14 w-14 rounded-full border-gray-300 bg-transparent text-gray-600 hover:bg-gray-50',
              isMuted && 'text-gray-400'
            )}
          >
            {isMuted ? <MicOff className='h-6 w-6' /> : <Mic className='h-6 w-6' />}
          </Button>
        </div>
      </div>
    </div>
  )
}
