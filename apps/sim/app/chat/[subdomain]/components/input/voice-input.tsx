'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic, MicOff } from 'lucide-react'

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
  onaudiostart?: ((this: SpeechRecognition, ev: Event) => any) | null
  onaudioend?: ((this: SpeechRecognition, ev: Event) => any) | null
  onsoundstart?: ((this: SpeechRecognition, ev: Event) => any) | null
  onsoundend?: ((this: SpeechRecognition, ev: Event) => any) | null
  onspeechstart?: ((this: SpeechRecognition, ev: Event) => any) | null
  onspeechend?: ((this: SpeechRecognition, ev: Event) => any) | null
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

interface VoiceInputProps {
  onTranscript: (text: string) => void
  onVoiceStart: () => void
  onVoiceEnd: () => void
  isListening: boolean
  setIsListening: (listening: boolean) => void
  disabled?: boolean
  onInterrupt?: () => void
  large?: boolean
}

export function VoiceInput({
  onTranscript,
  onVoiceStart,
  onVoiceEnd,
  isListening,
  setIsListening,
  disabled = false,
  onInterrupt,
  large = false,
}: VoiceInputProps) {
  const [isSupported, setIsSupported] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [audioLevels, setAudioLevels] = useState<number[]>([0, 0, 0, 0, 0])
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>(
    'prompt'
  )
  const [isHovered, setIsHovered] = useState(false)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const finalTranscriptRef = useRef<string>('')

  // Cleanup audio resources - define this first as it's used by other functions
  const cleanupAudio = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    analyserRef.current = null
    setAudioLevels([0, 0, 0, 0, 0])
  }, [])

  // Complete cleanup
  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    cleanupAudio()
  }, [cleanupAudio])

  // Handle recognition end - separate from initialization
  const handleRecognitionEnd = useCallback(() => {
    console.log('🔄 Handling recognition end...')
    setIsListening(false)
    onVoiceEnd()
    cleanupAudio()

    // Send the final transcript if we have one
    const finalText = finalTranscriptRef.current.trim()
    if (finalText) {
      console.log('📤 Sending transcript:', finalText)
      onTranscript(finalText)
    }

    // Reset transcript states
    setTranscript('')
    setInterimTranscript('')
    finalTranscriptRef.current = ''
  }, [onTranscript, onVoiceEnd, cleanupAudio, setIsListening])

  // Initialize Speech Recognition once when component mounts
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setIsSupported(!!SpeechRecognition)

    if (SpeechRecognition && !recognitionRef.current) {
      console.log('🎤 Initializing Speech Recognition...')
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onstart = () => {
        console.log('✅ Speech recognition started successfully!')
        console.log('🎤 Now listening... Please speak into your microphone')
        onVoiceStart()
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        console.log('📝 Speech recognition result received!')
        console.log('Results length:', event.results.length)
        console.log('Result index:', event.resultIndex)

        let finalTranscript = ''
        let interim = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const transcriptText = result[0].transcript

          console.log(`Result ${i}:`, {
            isFinal: result.isFinal,
            transcript: transcriptText,
            confidence: result[0].confidence,
          })

          if (result.isFinal) {
            finalTranscript += transcriptText
          } else {
            interim += transcriptText
          }
        }

        if (finalTranscript) {
          console.log('✅ Final transcript:', finalTranscript)
          finalTranscriptRef.current += finalTranscript
          setTranscript(finalTranscriptRef.current)
        }

        if (interim) {
          console.log('🔄 Interim transcript:', interim)
        }

        setInterimTranscript(interim)

        // Reset timeout for auto-stop
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(() => {
          console.log('⏱️ Auto-stop triggered after 3 seconds of silence')
          if (recognitionRef.current) {
            try {
              recognitionRef.current.stop()
            } catch (e) {
              console.log('Error stopping recognition:', e)
            }
          }
        }, 3000)
      }

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('❌ Speech recognition error:', event.error)
        console.error('Error details:', {
          error: event.error,
          message: event.message,
          type: event.type,
        })

        if (event.error === 'not-allowed') {
          setPermissionStatus('denied')
        } else if (event.error === 'no-speech') {
          console.log("🔇 No speech detected. Make sure you're speaking clearly.")
        } else if (event.error === 'audio-capture') {
          console.error('🎤 Microphone error. Check if another app is using your microphone.')
        } else if (event.error === 'network') {
          console.error('🌐 Network error. Speech recognition requires internet connection.')
        }

        handleRecognitionEnd()
      }

      recognition.onend = () => {
        console.log('🛑 Speech recognition ended')
        handleRecognitionEnd()
      }

      // Additional event listeners for debugging
      if (recognition.onaudiostart) {
        recognition.onaudiostart = () => {
          console.log('🔊 Audio capture started')
        }
      }

      if (recognition.onaudioend) {
        recognition.onaudioend = () => {
          console.log('🔇 Audio capture ended')
        }
      }

      if (recognition.onsoundstart) {
        recognition.onsoundstart = () => {
          console.log('🎵 Sound detected')
        }
      }

      if (recognition.onsoundend) {
        recognition.onsoundend = () => {
          console.log('🤫 Sound ended')
        }
      }

      if (recognition.onspeechstart) {
        recognition.onspeechstart = () => {
          console.log('💬 Speech detected')
        }
      }

      if (recognition.onspeechend) {
        recognition.onspeechend = () => {
          console.log('🤐 Speech ended')
        }
      }

      recognitionRef.current = recognition
      console.log('✅ Speech Recognition initialized and ready')
    }

    return () => {
      cleanup()
    }
  }, []) // Remove ALL dependencies to prevent re-initialization

  // Check microphone permission explicitly
  const checkMicrophonePermission = useCallback(async () => {
    try {
      // Check if we already have permission
      const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      setPermissionStatus(permission.state as 'granted' | 'denied' | 'prompt')

      console.log('Microphone permission status:', permission.state)

      return permission.state === 'granted'
    } catch (error) {
      console.log('Permission API not supported, will request directly')
      return false
    }
  }, [])

  // Setup audio visualization
  const setupAudioVisualization = useCallback(async (): Promise<boolean> => {
    try {
      console.log('Requesting microphone access...')

      // Check permission first
      const hasPermission = await checkMicrophonePermission()

      if (!hasPermission && permissionStatus === 'denied') {
        console.error('Microphone permission was previously denied')
        throw new Error(
          'Microphone permission denied. Please allow microphone access in your browser settings.'
        )
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      })

      console.log('Microphone access granted successfully!')
      setPermissionStatus('granted')
      streamRef.current = stream

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const analyser = audioContext.createAnalyser()
      const microphone = audioContext.createMediaStreamSource(stream)

      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      microphone.connect(analyser)

      audioContextRef.current = audioContext
      analyserRef.current = analyser

      // Start the visualization loop
      const updateVisualization = () => {
        if (!analyserRef.current || !isListening) return

        const bufferLength = analyserRef.current.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        analyserRef.current.getByteFrequencyData(dataArray)

        // Process audio data into 5 frequency bands
        const bands = 5
        const bandSize = Math.floor(bufferLength / bands)
        const levels = []

        for (let i = 0; i < bands; i++) {
          let sum = 0
          for (let j = i * bandSize; j < (i + 1) * bandSize; j++) {
            sum += dataArray[j]
          }
          const average = sum / bandSize
          levels.push(Math.min(100, (average / 255) * 100))
        }

        setAudioLevels(levels)

        if (isListening) {
          animationFrameRef.current = requestAnimationFrame(updateVisualization)
        }
      }

      updateVisualization()
      return true // Success
    } catch (error) {
      console.error('Error setting up audio visualization:', error)

      // Provide specific error messages
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          console.error('❌ Microphone permission denied by user or browser policy')
          console.error('💡 Solutions:')
          console.error('   1. Click the 🔒 icon in your browser address bar and allow microphone')
          console.error("   2. Ensure you're using HTTPS (not HTTP)")
          console.error('   3. Check browser settings for microphone permissions')
        } else if (error.name === 'NotFoundError') {
          console.error('❌ No microphone found on this device')
        } else if (error.name === 'NotSupportedError') {
          console.error("❌ Your browser doesn't support microphone access")
        }
      }

      setPermissionStatus('denied')
      setIsListening(false)
      onVoiceEnd()
      return false // Failure
    }
  }, [isListening, onVoiceEnd, checkMicrophonePermission, permissionStatus])

  const startListening = useCallback(async () => {
    console.log('🚀 startListening called')
    console.log('Current state:', {
      hasRecognition: !!recognitionRef.current,
      isListening,
      disabled,
      isSupported,
    })

    if (!isSupported) {
      console.error('❌ Speech recognition not supported in this browser')
      return
    }

    if (!recognitionRef.current || isListening || disabled) {
      console.log('❌ Cannot start:', {
        hasRecognition: !!recognitionRef.current,
        isListening,
        disabled,
      })
      return
    }

    // Call interrupt callback immediately when starting to listen
    // This allows stopping ongoing audio playback for true voice interruption
    onInterrupt?.()

    try {
      console.log('🎙️ Starting voice input process...')
      console.log('Browser:', navigator.userAgent)

      // Reset transcript
      finalTranscriptRef.current = ''
      setTranscript('')
      setInterimTranscript('')

      // Setup audio visualization first
      const audioSetupSuccess = await setupAudioVisualization()
      console.log('Audio setup result:', audioSetupSuccess !== false)

      // Set listening state after audio is ready
      setIsListening(true)

      // Try to start speech recognition with error handling
      try {
        console.log('🎯 Attempting to start speech recognition...')
        recognitionRef.current.start()
        console.log('✅ recognition.start() called successfully!')

        // Check if it's actually working after a delay
        setTimeout(() => {
          if (!transcript && !interimTranscript) {
            console.log('⚠️ No speech detected yet. Tips:')
            console.log('   • Speak clearly and loudly')
            console.log('   • Check your default microphone in system settings')
            console.log('   • Try saying "Hello" or "Testing"')
            console.log('   • Make sure no other apps are using the microphone')
          }
        }, 3000)
      } catch (startError: any) {
        console.error('❌ Error calling recognition.start():', startError)

        // Handle specific error cases
        if (
          startError.message?.includes('already started') ||
          startError.name === 'InvalidStateError'
        ) {
          console.log('🔄 Recognition already started, continuing...')
          // Don't treat this as an error, just continue
        } else {
          setIsListening(false)
          cleanupAudio()
        }
      }
    } catch (error) {
      console.error('❌ Error in startListening:', error)
      setIsListening(false)
      cleanupAudio()
    }
  }, [
    isListening,
    disabled,
    isSupported,
    setupAudioVisualization,
    cleanupAudio,
    onInterrupt,
    transcript,
    interimTranscript,
  ])

  const stopListening = useCallback(() => {
    console.log('Stopping voice input...')

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (error) {
        console.error('Error stopping speech recognition:', error)
      }
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    // Don't call handleRecognitionEnd here as it will be called by recognition.onend
  }, [])

  const toggleListening = useCallback(() => {
    console.log('Toggle listening clicked, current state:', isListening)
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  // Listen for auto-trigger voice events from conversation mode
  useEffect(() => {
    const handleAutoTrigger = () => {
      if (!isListening && !disabled && isSupported) {
        console.log('🎙️ Auto-trigger received, starting voice input...')
        startListening()
      }
    }

    window.addEventListener('auto-trigger-voice', handleAutoTrigger)

    return () => {
      window.removeEventListener('auto-trigger-voice', handleAutoTrigger)
    }
  }, [isListening, disabled, isSupported, startListening])

  if (!isSupported) {
    return null // Don't render anything if not supported
  }

  // Large mode for voice-first interface
  if (large) {
    return (
      <div className='flex flex-col items-center'>
        {/* Real-time Audio Visualization */}
        <AnimatePresence>
          {isListening && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className='mb-4 flex items-center space-x-2'
            >
              {/* Real-time audio bars with enhanced styling for light mode */}
              {audioLevels.map((level, i) => (
                <motion.div
                  key={i}
                  className='w-2 rounded-full bg-blue-500'
                  style={{
                    height: Math.max(8, (level / 100) * 32),
                  }}
                  transition={{
                    duration: 0.1,
                    ease: 'easeOut',
                  }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Large Voice Button */}
        <motion.button
          type='button'
          onClick={toggleListening}
          disabled={disabled}
          onHoverStart={() => setIsHovered(true)}
          onHoverEnd={() => setIsHovered(false)}
          className={`flex items-center justify-center rounded-full border-2 p-6 transition-all duration-200 ${
            isListening
              ? 'border-red-400 bg-red-500/20 text-red-600 hover:bg-red-500/30'
              : 'border-blue-300 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20'
          } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} `}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title={
            permissionStatus === 'denied'
              ? 'Microphone access denied'
              : isListening
                ? 'Stop listening'
                : 'Start voice input'
          }
        >
          {isListening ? <MicOff size={32} /> : <Mic size={32} />}
        </motion.button>

        {/* Live Transcript Display for large mode */}
        <AnimatePresence>
          {(transcript || interimTranscript) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className='mt-4 max-w-md rounded-lg bg-gray-50 px-4 py-2 text-center text-gray-900 backdrop-blur-sm'
            >
              {transcript}
              <span className='text-gray-500'>{interimTranscript}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  // Standard mode for regular chat interface
  return (
    <div className='flex items-center'>
      {/* Real-time Audio Visualization */}
      <AnimatePresence>
        {isListening && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className='mr-2 flex items-center space-x-1'
          >
            {/* Real-time audio bars based on microphone input */}
            {audioLevels.map((level, i) => (
              <motion.div
                key={i}
                className='w-1 rounded-full bg-blue-500'
                style={{
                  height: Math.max(4, (level / 100) * 16),
                }}
                transition={{
                  duration: 0.1,
                  ease: 'easeOut',
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice Button */}
      <motion.button
        type='button'
        onClick={toggleListening}
        disabled={disabled}
        onHoverStart={() => setIsHovered(true)}
        onHoverEnd={() => setIsHovered(false)}
        className={`flex items-center justify-center rounded-full p-2 transition-all duration-200 ${
          isListening
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} `}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title={
          permissionStatus === 'denied'
            ? 'Microphone access denied'
            : isListening
              ? 'Stop listening'
              : 'Start voice input'
        }
      >
        {isListening ? <MicOff size={16} /> : <Mic size={16} />}
      </motion.button>

      {/* Live Transcript Display */}
      <AnimatePresence>
        {(transcript || interimTranscript) && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className='ml-2 max-w-xs truncate rounded bg-gray-100 px-2 py-1 text-gray-700 text-sm'
          >
            {transcript}
            <span className='text-gray-400'>{interimTranscript}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
