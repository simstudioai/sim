'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FBOParticlesVisualization } from './fbo-particles'

interface VoiceFirstInterfaceProps {
  onVoiceData?: (data: Float32Array) => void
  onCallEnd?: () => void
  onVoiceTranscript?: (transcript: string) => void
  onVoiceStart?: () => void
  onVoiceEnd?: () => void
  onInterrupt?: () => void
  isStreaming?: boolean
  isPlayingAudio?: boolean
  messages?: Array<{ content: string; type: 'user' | 'assistant' }>
  className?: string
}

export function VoiceFirstInterface({
  onCallEnd,
  onVoiceTranscript,
  onVoiceStart,
  onVoiceEnd,
  onInterrupt,
  isStreaming = false,
  isPlayingAudio = false,
  messages = [],
  className,
}: VoiceFirstInterfaceProps) {
  const [isListening, setIsListening] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(200).fill(0))
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>(
    'prompt'
  )
  const [isInitialized, setIsInitialized] = useState(false)

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
  const interruptedTranscriptRef = useRef('')
  const interruptionTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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

    console.log('🧹 Cleaning up voice-first interface...')

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (aiAudioAnimationRef.current) {
      cancelAnimationFrame(aiAudioAnimationRef.current)
      aiAudioAnimationRef.current = null
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

    if (interruptionTimeoutRef.current) {
      clearTimeout(interruptionTimeoutRef.current)
      interruptionTimeoutRef.current = null
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

  // Initialize speech recognition only once
  const initializeSpeechRecognition = useCallback(() => {
    if (!isSupported || recognitionRef.current || isInitialized) return

    console.log('🎤 Initializing Speech Recognition for voice-first interface...')

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      if (isCleaningUpRef.current) return
      console.log('✅ Voice-first speech recognition started')
      setIsListening(true)
      hasInterruptedRef.current = false // Reset interruption flag
      interruptedTranscriptRef.current = '' // Clear any previous interrupted transcript

      // Clear any pending interruption timeout
      if (interruptionTimeoutRef.current) {
        clearTimeout(interruptionTimeoutRef.current)
        interruptionTimeoutRef.current = null
      }

      onVoiceStart?.()
    }

    recognition.onresult = (event: any) => {
      if (isCleaningUpRef.current) return

      let finalTranscript = ''
      let interim = ''
      let hasSignificantSpeech = false

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcriptText = result[0].transcript
        const confidence = result[0].confidence || 1 // Default to 1 if not available

        // Check if we have meaningful speech (not just noise)
        // Require at least 5 characters and reasonable confidence
        if (transcriptText.trim().length >= 5 && confidence > 0.5) {
          hasSignificantSpeech = true
          console.log('🎯 Significant speech detected:', {
            text: transcriptText.trim(),
            length: transcriptText.trim().length,
            confidence,
            isFinal: result.isFinal,
          })
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
        console.log('🛑 Substantial speech detected, interrupting audio playback')
        hasInterruptedRef.current = true

        // Store the interrupting speech (both interim and any final parts)
        const currentSpeech = `${finalTranscript} ${interim}`.trim()
        interruptedTranscriptRef.current = currentSpeech
        console.log('💬 Interrupting speech:', currentSpeech)

        // Interrupt the current playback
        onInterrupt?.()

        // Set a timeout to process the interrupted speech if no final transcript comes
        if (interruptionTimeoutRef.current) {
          clearTimeout(interruptionTimeoutRef.current)
        }

        interruptionTimeoutRef.current = setTimeout(() => {
          if (interruptedTranscriptRef.current && interruptedTranscriptRef.current.length >= 5) {
            console.log(
              '⏱️ Processing interrupted speech after timeout:',
              interruptedTranscriptRef.current
            )
            onVoiceTranscript?.(interruptedTranscriptRef.current)
            interruptedTranscriptRef.current = ''

            // Stop recognition to reset for next input
            if (recognitionRef.current) {
              try {
                recognitionRef.current.stop()
              } catch (e) {
                // Ignore errors
              }
            }
          }
        }, 1500) // Wait 1.5 seconds for final transcript before processing
      }

      if (finalTranscript) {
        console.log('📝 Voice-first final transcript:', finalTranscript)

        // Clear any interruption timeout since we got a final transcript
        if (interruptionTimeoutRef.current) {
          clearTimeout(interruptionTimeoutRef.current)
          interruptionTimeoutRef.current = null
        }

        // If we interrupted, append to the interrupted transcript
        if (hasInterruptedRef.current && interruptedTranscriptRef.current) {
          finalTranscript = `${interruptedTranscriptRef.current} ${finalTranscript}`
          interruptedTranscriptRef.current = '' // Clear after using
        }

        onVoiceTranscript?.(finalTranscript)
        // Clear transcripts after sending
        setTranscript('')
        setInterimTranscript('')
      }

      setInterimTranscript(interim)

      // Reset timeout for auto-stop
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        if (recognitionRef.current && !isCleaningUpRef.current) {
          console.log('⏱️ Auto-stop triggered in voice-first mode')
          try {
            recognitionRef.current.stop()
          } catch (e) {
            // Ignore errors
          }
        }
      }, 3000)
    }

    recognition.onerror = (event: any) => {
      if (isCleaningUpRef.current) return

      console.log('⚠️ Voice-first speech recognition error:', event.error)

      // Only handle critical errors
      if (event.error === 'not-allowed') {
        setPermissionStatus('denied')
        setIsListening(false)
        onVoiceEnd?.()
      }
      // Ignore 'aborted' and other non-critical errors
    }

    recognition.onend = () => {
      if (isCleaningUpRef.current) return

      console.log('🛑 Voice-first speech recognition ended')
      setIsListening(false)
      onVoiceEnd?.()

      // Clear any remaining transcripts
      setTranscript('')
      setInterimTranscript('')
    }

    recognitionRef.current = recognition
    setIsInitialized(true)
  }, [isSupported, isInitialized, onVoiceStart, onVoiceEnd, onVoiceTranscript, onInterrupt])

  // Setup audio visualization
  const setupAudioVisualization = useCallback(async () => {
    if (isCleaningUpRef.current) return false

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
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

        // Log significant audio activity only when not muted
        if (avgLevel > 10 && !isMuted) {
          console.log('🎤 Audio activity detected:', avgLevel)
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
      console.error('Error setting up audio visualization:', error)
      setPermissionStatus('denied')
      return false
    }
  }, [isMuted, isListening])

  // Start listening
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

    console.log('🚀 Starting voice-first listening...')
    // Don't interrupt immediately - wait for actual speech

    try {
      await setupAudioVisualization()
      setTranscript('')
      setInterimTranscript('')

      // Start recognition
      if (recognitionRef.current && !isCleaningUpRef.current) {
        try {
          recognitionRef.current.start()
        } catch (error: any) {
          if (!error.message?.includes('already started')) {
            console.error('Error starting recognition:', error)
          }
        }
      }
    } catch (error) {
      console.error('Error starting voice input:', error)
      setIsListening(false)
    }
  }, [isSupported, isListening, setupAudioVisualization, isMuted])

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening && !isCleaningUpRef.current) {
      console.log('🛑 Stopping voice-first listening...')
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
      console.log('🔇 Muting microphone and stopping recognition')
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
      // When unmuting, re-enable tracks and restart listening
      console.log('🔊 Unmuting microphone')
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }
      // Restart listening after a short delay
      if (!isListening && !isCleaningUpRef.current) {
        setTimeout(() => {
          startListening()
        }, 500)
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
    } else if (aiAudioAnimationRef.current) {
      // Stop AI audio simulation
      cancelAnimationFrame(aiAudioAnimationRef.current)
      aiAudioAnimationRef.current = null
    }
  }, [isPlayingAudio, isListening, simulateAIAudioLevels])

  // Initialize when component mounts
  useEffect(() => {
    if (isSupported && !isInitialized) {
      initializeSpeechRecognition()
    }
  }, [isSupported, isInitialized, initializeSpeechRecognition])

  // Start audio visualization immediately for baseline animation
  useEffect(() => {
    if (isInitialized && !mediaStreamRef.current && !isCleaningUpRef.current) {
      const timer = setTimeout(() => {
        setupAudioVisualization()
      }, 500)

      return () => clearTimeout(timer)
    }
  }, [isInitialized, setupAudioVisualization])

  // Auto-start listening after initialization
  useEffect(() => {
    if (isInitialized && !isListening && !isCleaningUpRef.current && !isMuted) {
      const timer = setTimeout(() => {
        startListening()
      }, 1000) // Longer delay to ensure everything is ready

      return () => clearTimeout(timer)
    }
  }, [isInitialized, isListening, startListening, isMuted])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  // Get current status text
  const getStatusText = () => {
    if (isStreaming) return 'Thinking...'
    if (isPlayingAudio) return 'Speaking...'
    if (isListening) return 'Listening...'
    return 'Ready'
  }

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
          <FBOParticlesVisualization
            audioLevels={audioLevels}
            isListening={isListening}
            isPlayingAudio={isPlayingAudio}
            isStreaming={isStreaming}
            isMuted={isMuted}
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
            variant={isMuted ? 'outline' : 'default'}
            size='icon'
            className={cn(
              'h-14 w-14 rounded-full',
              isMuted
                ? 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                : 'bg-blue-500 text-white hover:bg-blue-600'
            )}
          >
            {isMuted ? <MicOff className='h-6 w-6' /> : <Mic className='h-6 w-6' />}
          </Button>
        </div>
      </div>
    </div>
  )
}
