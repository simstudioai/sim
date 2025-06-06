'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { ParticlesVisualization } from './components/particles'

const logger = createLogger('VoiceInterface')

interface VoiceInterfaceProps {
  onVoiceData?: (data: Float32Array) => void
  onCallEnd?: () => void
  onVoiceTranscript?: (transcript: string) => void
  onVoiceStart?: () => void
  onVoiceEnd?: () => void
  onInterrupt?: () => void
  onAudioChunkStart?: () => void
  onResetInterruption?: (resetFn: () => void) => void
  isStreaming?: boolean
  isPlayingAudio?: boolean
  messages?: Array<{ content: string; type: 'user' | 'assistant' }>
  className?: string
}

export function VoiceInterface({
  onCallEnd,
  onVoiceTranscript,
  onVoiceStart,
  onVoiceEnd,
  onInterrupt,
  onAudioChunkStart,
  onResetInterruption,
  isStreaming = false,
  isPlayingAudio = false,
  messages = [],
  className,
}: VoiceInterfaceProps) {
  const [isListening, setIsListening] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(200).fill(0))
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>(
    'prompt'
  )
  const [isInitialized, setIsInitialized] = useState(false)
  const [isProcessingInterruption, setIsProcessingInterruption] = useState(false)

  const recognitionRef = useRef<any>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isCleaningUpRef = useRef(false)
  const aiAudioAnimationRef = useRef<number | null>(null)
  const hasInterruptedRef = useRef(false)
  const isMutedRef = useRef(false)
  const isPlayingAudioRef = useRef(false)
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Keep refs in sync with state for use in callbacks
  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  useEffect(() => {
    isPlayingAudioRef.current = isPlayingAudio
  }, [isPlayingAudio])

  // Check if speech recognition is supported
  const isSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  // Cleanup function
  const cleanup = useCallback(() => {
    if (isCleaningUpRef.current) return
    isCleaningUpRef.current = true

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (aiAudioAnimationRef.current) {
      cancelAnimationFrame(aiAudioAnimationRef.current)
      aiAudioAnimationRef.current = null
    }

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null
        recognitionRef.current.onend = null
        recognitionRef.current.onresult = null
        recognitionRef.current.onerror = null
        recognitionRef.current.abort()
      } catch (e) {
        // Ignore errors during cleanup
      }
      recognitionRef.current = null
    }

    analyserRef.current = null
    setAudioLevels(new Array(200).fill(0))
    setIsListening(false)
    setIsInitialized(false)

    setTimeout(() => {
      isCleaningUpRef.current = false
    }, 100)
  }, [])

  // Restart speech recognition with immediate retry
  const restartRecognition = useCallback(() => {
    if (isCleaningUpRef.current || isMutedRef.current || !recognitionRef.current) return

    try {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    } catch (e) {
      // Ignore stop errors
    }

    // Clear any existing restart timeout
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }

    // Immediate restart for better responsiveness
    restartTimeoutRef.current = setTimeout(() => {
      if (!isCleaningUpRef.current && !isMutedRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start()
        } catch (error: any) {
          if (!error.message?.includes('already started')) {
            logger.error('Error restarting recognition:', error)
          }
        }
      }
    }, 100) // Very short delay for immediate restart
  }, [])

  // Initialize speech recognition only once
  const initializeSpeechRecognition = useCallback(() => {
    if (!isSupported || recognitionRef.current || isInitialized) return

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      if (isCleaningUpRef.current) return
      setIsListening(true)
      hasInterruptedRef.current = false // Reset interruption flag
      onVoiceStart?.()
    }

    recognition.onresult = (event: any) => {
      if (isCleaningUpRef.current) return

      let finalTranscript = ''
      let interim = ''
      let hasSignificantSpeech = false

      // More aggressive thresholds for faster interruption detection
      const MIN_CHAR_THRESHOLD = 2
      const MIN_WORD_THRESHOLD = 1
      const CONFIDENCE_THRESHOLD = 0.2 // Lower threshold for faster detection

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcriptText = result[0].transcript
        const confidence = result[0].confidence || 1 // Default to 1 if not available
        const trimmedText = transcriptText.trim()
        const wordCount = trimmedText.split(/\s+/).filter(Boolean).length

        // Check if we have meaningful speech (not just noise)
        if (
          trimmedText.length >= MIN_CHAR_THRESHOLD &&
          wordCount >= MIN_WORD_THRESHOLD &&
          confidence >= CONFIDENCE_THRESHOLD
        ) {
          hasSignificantSpeech = true
        }

        if (result.isFinal) {
          finalTranscript += transcriptText
        } else {
          interim += transcriptText
        }
      }

      // Interrupt only when:
      // 1. We detect significant speech
      // 2. Haven't already interrupted this session
      // 3. AI is currently playing audio
      // 4. We're not muted
      if (
        hasSignificantSpeech &&
        !hasInterruptedRef.current &&
        isPlayingAudioRef.current &&
        !isMutedRef.current
      ) {
        hasInterruptedRef.current = true
        setIsProcessingInterruption(true)
        onInterrupt?.()
      }

      if (finalTranscript) {
        // If we just interrupted, add a small delay for clearer transition
        if (hasInterruptedRef.current) {
          setTimeout(() => {
            setIsProcessingInterruption(false)
            onVoiceTranscript?.(finalTranscript)
          }, 300) // Shorter delay for better responsiveness
        } else {
          onVoiceTranscript?.(finalTranscript)
        }

        // Clear transcripts after sending
        setTranscript('')
        setInterimTranscript('')
      }

      setInterimTranscript(interim)

      // Keep recognition alive always - no auto-stop during audio playback
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Only set auto-stop timeout if AI is not playing audio
      if (!isPlayingAudioRef.current) {
        timeoutRef.current = setTimeout(() => {
          if (recognitionRef.current && !isCleaningUpRef.current && !isPlayingAudioRef.current) {
            restartRecognition()
          }
        }, 5000) // Longer timeout when not playing audio
      }
    }

    recognition.onerror = (event: any) => {
      if (isCleaningUpRef.current) return

      // Permission denied is the only truly fatal error
      if (event.error === 'not-allowed') {
        setPermissionStatus('denied')
        setIsListening(false)
        onVoiceEnd?.()
        return
      }

      // For all other errors, aggressively restart immediately
      setTimeout(() => {
        if (!isCleaningUpRef.current && !isMutedRef.current && recognitionRef.current) {
          try {
            // Try to stop first (in case it's in a weird state)
            recognitionRef.current.stop()
          } catch (e) {
            // Ignore stop errors
          }

          // Then start again
          setTimeout(() => {
            if (!isCleaningUpRef.current && !isMutedRef.current && recognitionRef.current) {
              try {
                recognitionRef.current.start()
              } catch (restartError: any) {
                if (!restartError.message?.includes('already started')) {
                  logger.error('Failed to restart after error:', restartError)
                  setIsListening(false)
                  onVoiceEnd?.()
                }
              }
            }
          }, 100)
        }
      }, 50)
    }

    recognition.onend = () => {
      if (isCleaningUpRef.current) return

      setIsProcessingInterruption(false)

      // Clear any remaining transcripts
      setTranscript('')
      setInterimTranscript('')

      // Immediately restart recognition for continuous listening (unless muted)
      if (!isMutedRef.current && !isCleaningUpRef.current) {
        // Use setTimeout with 0 delay to ensure it runs after current event loop
        setTimeout(() => {
          if (!isCleaningUpRef.current && !isMutedRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start()
            } catch (error: any) {
              if (!error.message?.includes('already started')) {
                logger.error('Error restarting recognition after onend:', error)
                // Only set to false if we truly can't restart
                setIsListening(false)
                onVoiceEnd?.()
              }
            }
          } else {
            // Only set to false if we can't restart (muted or cleaning up)
            setIsListening(false)
            onVoiceEnd?.()
          }
        }, 0)
      } else {
        // Only set to false if we're muted or cleaning up
        setIsListening(false)
        onVoiceEnd?.()
      }
    }

    recognitionRef.current = recognition
    setIsInitialized(true)
  }, [
    isSupported,
    isInitialized,
    onVoiceStart,
    onVoiceEnd,
    onVoiceTranscript,
    onInterrupt,
    setIsProcessingInterruption,
    restartRecognition,
  ])

  // Setup audio visualization with enhanced echo cancellation
  const setupAudioVisualization = useCallback(async () => {
    if (isCleaningUpRef.current) return false

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          // More aggressive echo cancellation settings
          channelCount: 1,
        },
      })

      if (isCleaningUpRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return false
      }

      setPermissionStatus('granted')
      mediaStreamRef.current = stream

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const analyser = audioContext.createAnalyser()
      const microphone = audioContext.createMediaStreamSource(stream)

      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.8
      microphone.connect(analyser)

      audioContextRef.current = audioContext
      analyserRef.current = analyser

      // Start continuous visualization loop
      const updateVisualization = () => {
        if (!analyserRef.current || isCleaningUpRef.current) return

        const bufferLength = analyserRef.current.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        analyserRef.current.getByteFrequencyData(dataArray)

        // Calculate average level for debugging
        const avgLevel = dataArray.reduce((sum, val) => sum + val, 0) / bufferLength

        // Critical fix: If we're detecting audio activity but speech recognition isn't listening,
        // and we're supposed to be listening (not muted, audio playing), restart it immediately
        if (
          isPlayingAudioRef.current &&
          !isListening &&
          !isMutedRef.current &&
          recognitionRef.current
        ) {
          try {
            recognitionRef.current.start()
          } catch (error: any) {
            if (!error.message?.includes('already started')) {
              logger.error('Failed to restart recognition during playback:', error)
            }
          }
        }

        // Create circular pattern similar to Perplexity
        const levels = []
        const numPoints = 200

        for (let i = 0; i < numPoints; i++) {
          const dataIndex = Math.floor((i / numPoints) * bufferLength)
          const value = dataArray[dataIndex] || 0
          // When muted, show zero levels
          const normalizedValue = isMuted ? 0 : (value / 255) * 100
          levels.push(normalizedValue)
        }

        setAudioLevels(levels)

        // Continue animation loop regardless of listening state
        if (!isCleaningUpRef.current) {
          animationFrameRef.current = requestAnimationFrame(updateVisualization)
        }
      }

      updateVisualization()
      return true
    } catch (error) {
      logger.error('Error setting up audio visualization:', error)
      setPermissionStatus('denied')
      return false
    }
  }, [isMuted, isListening])

  // Start listening immediately
  const startListening = useCallback(async () => {
    if (
      !isSupported ||
      !recognitionRef.current ||
      isListening ||
      isCleaningUpRef.current ||
      isMuted
    ) {
      return
    }

    try {
      // Setup audio visualization first
      if (!mediaStreamRef.current) {
        await setupAudioVisualization()
      }

      setTranscript('')
      setInterimTranscript('')

      // Start recognition immediately
      if (recognitionRef.current && !isCleaningUpRef.current) {
        try {
          recognitionRef.current.start()
        } catch (error: any) {
          if (!error.message?.includes('already started')) {
            logger.error('Error starting recognition:', error)
          }
        }
      }
    } catch (error) {
      logger.error('Error starting voice input:', error)
      setIsListening(false)
    }
  }, [isSupported, isListening, setupAudioVisualization, isMuted])

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening && !isCleaningUpRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (error) {
        // Ignore errors during stop
      }
    }
  }, [isListening])

  // Toggle mute
  const toggleMute = useCallback(() => {
    const newMutedState = !isMuted

    if (newMutedState) {
      // When muting, stop listening completely
      if (recognitionRef.current && isListening) {
        try {
          recognitionRef.current.stop()
        } catch (e) {
          // Ignore errors
        }
      }
      // Disable audio tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
      }
    } else {
      // When unmuting, re-enable tracks and restart listening immediately
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }
      // Restart listening immediately
      if (!isListening && !isCleaningUpRef.current) {
        setTimeout(() => {
          startListening()
        }, 100) // Very short delay
      }
    }

    setIsMuted(newMutedState)
  }, [isMuted, isListening, startListening])

  // End call
  const handleEndCall = useCallback(() => {
    cleanup()
    onCallEnd?.()
  }, [cleanup, onCallEnd])

  // Simulate audio levels for AI speech
  const simulateAIAudioLevels = useCallback(() => {
    if (isCleaningUpRef.current) return

    const numPoints = 200
    const levels = []
    const time = Date.now() * 0.005

    for (let i = 0; i < numPoints; i++) {
      // Create dynamic, speech-like patterns
      const baseFreq = Math.sin(time + i * 0.1) * 30 + 40
      const variation = Math.sin(time * 2 + i * 0.05) * 20
      const speechPattern = Math.sin(time * 3 + i * 0.02) * 15
      const level = Math.max(0, baseFreq + variation + speechPattern)
      levels.push(level)
    }

    setAudioLevels(levels)

    if (isPlayingAudio && !isCleaningUpRef.current) {
      aiAudioAnimationRef.current = requestAnimationFrame(simulateAIAudioLevels)
    }
  }, [isPlayingAudio])

  // Handle AI audio playback state changes
  useEffect(() => {
    if (isPlayingAudio && !isListening) {
      // Reset interruption flag when AI starts speaking
      hasInterruptedRef.current = false
      // Start simulating AI audio levels
      simulateAIAudioLevels()

      // Ensure speech recognition is running during audio playback
      if (!isListening && !isMuted && recognitionRef.current) {
        startListening()
      }
    } else if (aiAudioAnimationRef.current) {
      // Stop AI audio simulation
      cancelAnimationFrame(aiAudioAnimationRef.current)
      aiAudioAnimationRef.current = null
    }
  }, [isPlayingAudio, isListening, simulateAIAudioLevels, isMuted, startListening])

  // Initialize when component mounts
  useEffect(() => {
    if (isSupported && !isInitialized) {
      initializeSpeechRecognition()
    }
  }, [isSupported, isInitialized, initializeSpeechRecognition])

  // Start audio visualization and listening immediately after initialization
  useEffect(() => {
    if (isInitialized && !mediaStreamRef.current && !isCleaningUpRef.current) {
      setupAudioVisualization().then((success) => {
        if (success && !isMuted) {
          // Start listening immediately after audio setup
          setTimeout(() => startListening(), 200)
        }
      })
    }
  }, [isInitialized, setupAudioVisualization, startListening, isMuted])

  // Ensure speech recognition restarts immediately when needed
  useEffect(() => {
    if (
      isInitialized &&
      !isListening &&
      !isCleaningUpRef.current &&
      !isMuted &&
      recognitionRef.current
    ) {
      startListening()
    }
  }, [isInitialized, isListening, startListening, isMuted])

  // Periodic check to ensure speech recognition stays active during audio playback
  useEffect(() => {
    if (!isPlayingAudio || isMuted || !recognitionRef.current) return

    const checkInterval = setInterval(() => {
      // Check if speech recognition should be active but isn't
      if (
        isPlayingAudio &&
        !isListening &&
        !isMuted &&
        !isCleaningUpRef.current &&
        recognitionRef.current &&
        recognitionRef.current.state !== 'active'
      ) {
        try {
          recognitionRef.current.start()
        } catch (error: any) {
          if (!error.message?.includes('already started')) {
            console.error('Periodic restart failed:', error)
          }
        }
      }
    }, 2000) // Check every 2 seconds

    return () => clearInterval(checkInterval)
  }, [isPlayingAudio, isListening, isMuted])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  // Get current status text
  const getStatusText = () => {
    if (isProcessingInterruption) return 'Processing...'
    if (isStreaming) return 'Thinking...'
    if (isPlayingAudio) return 'Speaking...'
    if (isListening) return 'Listening...'
    return 'Ready'
  }

  // Reset interruption flag to allow new interruptions
  const resetInterruptionFlag = useCallback(() => {
    hasInterruptedRef.current = false
  }, [])

  // Expose reset function through callback
  useEffect(() => {
    if (onResetInterruption) {
      // Provide the reset function to the parent
      onResetInterruption(resetInterruptionFlag)
    }
  }, [onResetInterruption, resetInterruptionFlag])

  // Also reset interruption flag when new audio chunks are detected
  useEffect(() => {
    if (isPlayingAudio) {
      // Reset interruption flag when audio starts playing
      resetInterruptionFlag()
    }
  }, [isPlayingAudio, resetInterruptionFlag])

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
            isProcessingInterruption={isProcessingInterruption}
          />
        </div>

        {/* Status text */}
        <div className='mb-8 text-center'>
          <p className='font-light text-gray-600 text-lg'>
            {getStatusText()}
            {isMuted && <span className='ml-2 text-gray-400 text-sm'>(Muted)</span>}
          </p>
          {/* Debug info */}
          {process.env.NODE_ENV === 'development' && (
            <div className='mt-2 space-y-1 text-gray-400 text-xs'>
              <p>
                Recognition: {isListening ? 'Active' : 'Inactive'} | Audio:{' '}
                {isPlayingAudio ? 'Playing' : 'Silent'} | Initialized:{' '}
                {isInitialized ? 'Yes' : 'No'}
              </p>
              <p>
                State: {recognitionRef.current?.state || 'null'} | Muted: {isMuted ? 'Yes' : 'No'} |
                Processing Interruption: {isProcessingInterruption ? 'Yes' : 'No'}
              </p>
              <p>
                Has Interrupted: {hasInterruptedRef.current ? 'Yes' : 'No'} | Permission:{' '}
                {permissionStatus}
              </p>
            </div>
          )}
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
