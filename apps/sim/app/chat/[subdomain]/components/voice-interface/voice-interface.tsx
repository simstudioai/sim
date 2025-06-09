'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { ParticlesVisualization } from './components/particles'

const logger = createLogger('VoiceInterface')

interface VoiceInterfaceProps {
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

// Simple conversation states
type ConversationState = 'listening' | 'responding' | 'idle'

export function VoiceInterface({
  onCallEnd,
  onVoiceTranscript,
  onVoiceStart,
  onVoiceEnd,
  onInterrupt,
  isStreaming = false,
  isPlayingAudio = false,
  messages = [],
  className,
}: VoiceInterfaceProps) {
  const [conversationState, setConversationState] = useState<ConversationState>('idle')
  const [isMuted, setIsMuted] = useState(false)
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(200).fill(0))
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt'>(
    'prompt'
  )
  const [audioStartTime, setAudioStartTime] = useState<number | null>(null)
  const [hasInterrupted, setHasInterrupted] = useState(false)

  const recognitionRef = useRef<any>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const aiAudioAnimationRef = useRef<number | null>(null)

  const isSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  // Echo protection: Check if transcript might be echo from AI audio
  const checkForEcho = useCallback(
    (transcript: string): boolean => {
      // Strong timing-based echo protection: if audio just started, very likely echo
      if (audioStartTime && Date.now() - audioStartTime < 750) {
        return true
      }

      // Only check for exact word matches in the current AI response (not all messages)
      // Focus on the current response that's playing
      const recentAiMessages = messages.filter((m) => m.type === 'assistant').slice(-1) // Only last message
      for (const message of recentAiMessages) {
        // Check for exact sequential word matches (not just contains)
        const aiWords = message.content.toLowerCase().split(/\s+/).slice(0, 15) // First 15 words of current response
        const transcriptWords = transcript.toLowerCase().split(/\s+/)

        // Look for consecutive word matches (stronger echo indicator)
        let maxConsecutiveMatches = 0
        let currentConsecutiveMatches = 0

        for (let i = 0; i < transcriptWords.length; i++) {
          if (aiWords.includes(transcriptWords[i]) && transcriptWords[i].length > 3) {
            currentConsecutiveMatches++
          } else {
            maxConsecutiveMatches = Math.max(maxConsecutiveMatches, currentConsecutiveMatches)
            currentConsecutiveMatches = 0
          }
        }
        maxConsecutiveMatches = Math.max(maxConsecutiveMatches, currentConsecutiveMatches)

        // Only flag as echo if we have 3+ consecutive exact word matches
        if (maxConsecutiveMatches >= 3) {
          return true
        }
      }

      return false
    },
    [audioStartTime, messages]
  )

  // Check audio levels to distinguish real user speech from echo
  const checkAudioLevelsForRealSpeech = useCallback((): boolean => {
    if (!analyserRef.current) return true // Default to allowing if no analysis available

    // Get current audio levels
    const bufferLength = analyserRef.current.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)
    analyserRef.current.getByteFrequencyData(dataArray)

    // Calculate average level in the human speech frequency range (300-3400 Hz)
    const sampleRate = 44100
    const frequencyBinWidth = sampleRate / 2 / bufferLength
    const startBin = Math.floor(300 / frequencyBinWidth)
    const endBin = Math.floor(3400 / frequencyBinWidth)

    let sum = 0
    let count = 0
    for (let i = startBin; i < Math.min(endBin, bufferLength); i++) {
      sum += dataArray[i]
      count++
    }

    const averageLevel = count > 0 ? sum / count : 0

    // Real user speech typically has higher energy levels
    // If level is too low, it's likely echo or background noise
    const threshold = 8 // Lowered threshold to be more permissive for real speech

    logger.info(`🔊 Audio level check: ${averageLevel.toFixed(1)} (threshold: ${threshold})`)

    return averageLevel > threshold
  }, [])

  // Cleanup function
  const cleanup = useCallback(() => {
    logger.info('🧹 Cleaning up voice interface')

    // Stop all animations
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (aiAudioAnimationRef.current) {
      cancelAnimationFrame(aiAudioAnimationRef.current)
      aiAudioAnimationRef.current = null
    }

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null
        recognitionRef.current.onend = null
        recognitionRef.current.onresult = null
        recognitionRef.current.onerror = null
        recognitionRef.current.abort()
      } catch (e) {
        // Ignore cleanup errors
      }
      recognitionRef.current = null
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    analyserRef.current = null
    setAudioLevels(new Array(200).fill(0))
    setConversationState('idle')
  }, [])

  // Initialize speech recognition
  const initializeSpeechRecognition = useCallback(() => {
    if (!isSupported || recognitionRef.current) return

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      logger.info('🎤 Speech recognition started')
      setConversationState('listening')
      onVoiceStart?.()
    }

    recognition.onresult = (event: any) => {
      let finalTranscript = ''
      let interimTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript
        } else {
          interimTranscript += result[0].transcript
        }
      }

      const anyTranscript = finalTranscript.trim() || interimTranscript.trim()

      // DEBUG: Log all speech detection with CURRENT state
      if (anyTranscript) {
        // Use setConversationState callback to get actual current state
        setConversationState((currentState) => {
          logger.info(`🗣️ Speech detected (${currentState}):`, {
            final: finalTranscript,
            interim: interimTranscript,
            isFinal: !!finalTranscript.trim(),
          })
          return currentState // Don't change state, just read it
        })
      }

      // Check for interruption on ANY speech (even interim) during responding state
      // BUT add echo protection to avoid detecting AI's own audio
      if (anyTranscript) {
        setConversationState((currentState) => {
          if (currentState === 'responding') {
            // Check if we've already interrupted this response to prevent duplicates
            if (hasInterrupted) {
              logger.info('🔇 Already interrupted this response, ignoring:', anyTranscript)
              return currentState
            }

            // PRIMARY: Check audio levels first (most reliable indicator)
            const audioLevelCheck = checkAudioLevelsForRealSpeech()

            if (!audioLevelCheck) {
              logger.info('🔇 Audio levels suggest this is echo, not user speech:', anyTranscript)
              return currentState
            }

            // SECONDARY: Check content-based echo detection (more permissive now)
            const isLikelyEcho = checkForEcho(anyTranscript)

            if (isLikelyEcho) {
              logger.info('🔇 Content suggests this is echo from AI audio:', anyTranscript)
              return currentState
            }

            // If we get here, it's likely real user speech - trigger interruption
            logger.info('🚫 REAL USER INTERRUPTION DETECTED! Calling onInterrupt()', anyTranscript)
            setHasInterrupted(true) // Mark that we've interrupted to prevent duplicates
            onInterrupt?.()
            return currentState // Keep in responding state temporarily
          }
          return currentState
        })
      }

      // Only process final transcripts for actual user input
      if (finalTranscript.trim()) {
        logger.info('📝 Final transcript:', finalTranscript)

        // Reset interruption flag when processing new user input
        setHasInterrupted(false)

        // Stop recognition and send transcript
        try {
          recognition.stop()
        } catch (error) {
          logger.error('Error stopping recognition:', error)
        }
        onVoiceTranscript?.(finalTranscript.trim())
      }
    }

    recognition.onerror = (event: any) => {
      logger.error('❌ Speech recognition error:', event.error)

      if (event.error === 'not-allowed') {
        setPermissionStatus('denied')
      }

      setConversationState('idle')
      onVoiceEnd?.()
    }

    recognition.onend = () => {
      logger.info('🔇 Speech recognition ended')
      setConversationState('idle')
      onVoiceEnd?.()
    }

    recognitionRef.current = recognition
  }, [isSupported, onVoiceStart, onVoiceEnd, onVoiceTranscript, onInterrupt])

  // Toggle mute
  const toggleMute = useCallback(() => {
    const newMutedState = !isMuted
    setIsMuted(newMutedState)

    if (newMutedState) {
      // Muted: stop listening
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch (error) {
          logger.error('Error stopping recognition:', error)
        }
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false
        })
      }
    } else {
      // Unmuted: re-enable audio and start listening if idle
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true
        })
      }
      if (conversationState === 'idle' && recognitionRef.current) {
        setTimeout(() => {
          if (recognitionRef.current && !newMutedState) {
            try {
              recognitionRef.current.start()
              logger.info('🎤 Starting to listen for user input')
            } catch (error: any) {
              if (!error.message?.includes('already started')) {
                logger.error('Error starting recognition:', error)
              }
            }
          }
        }, 100)
      }
    }
  }, [isMuted, conversationState])

  // Handle conversation state changes based on external props
  useEffect(() => {
    if (isPlayingAudio || isStreaming) {
      // AI is responding: RESTART speech recognition to listen for interruptions
      if (conversationState !== 'responding') {
        logger.info('🤖 AI is responding, starting speech recognition for interruption detection')
        setConversationState('responding')
        setAudioStartTime(Date.now()) // Track when AI audio starts for echo protection
        setHasInterrupted(false) // Reset interruption flag for new AI response

        // CRITICAL: Start speech recognition during AI response for interruption detection
        if (!isMuted && recognitionRef.current) {
          logger.info('🎤 Attempting to start speech recognition for interruption detection...')

          // Give more time for previous recognition to fully stop
          setTimeout(() => {
            if (recognitionRef.current && !isMuted && (isPlayingAudio || isStreaming)) {
              try {
                // Double-check the recognition state
                logger.info(
                  '🎤 Recognition state before restart:',
                  recognitionRef.current.state || 'unknown'
                )

                recognitionRef.current.start()
                logger.info(
                  '🎤✅ Started speech recognition during AI response for interruption detection'
                )
              } catch (error: any) {
                if (error.message?.includes('already started')) {
                  logger.info(
                    '🎤 Speech recognition already running (good for interruption detection)'
                  )
                } else {
                  logger.error('🎤❌ Error starting recognition during AI response:', error)

                  // Try again after a bit more delay
                  setTimeout(() => {
                    if (recognitionRef.current && !isMuted && (isPlayingAudio || isStreaming)) {
                      try {
                        recognitionRef.current.start()
                        logger.info('🎤✅ Started speech recognition on retry')
                      } catch (retryError: any) {
                        logger.error('🎤❌ Failed to start recognition on retry:', retryError)
                      }
                    }
                  }, 500)
                }
              }
            } else {
              logger.warn('🎤 Cannot start recognition: muted or not responding anymore')
            }
          }, 500) // Longer delay to ensure previous recognition is fully stopped
        }

        // Start AI audio animation
        const simulateAI = () => {
          const numPoints = 200
          const levels = []
          const time = Date.now() * 0.005

          for (let i = 0; i < numPoints; i++) {
            const baseFreq = Math.sin(time + i * 0.1) * 30 + 40
            const variation = Math.sin(time * 2 + i * 0.05) * 20
            const speechPattern = Math.sin(time * 3 + i * 0.02) * 15
            const level = Math.max(0, baseFreq + variation + speechPattern)
            levels.push(level)
          }

          setAudioLevels(levels)

          // Continue animation if still responding
          if (isPlayingAudio || isStreaming) {
            aiAudioAnimationRef.current = requestAnimationFrame(simulateAI)
          }
        }
        simulateAI()
      }
    } else {
      // AI finished responding: continue with normal listening
      if (conversationState === 'responding') {
        logger.info('✅ AI finished responding, continuing normal listening')

        // Cancel AI audio animation
        if (aiAudioAnimationRef.current) {
          cancelAnimationFrame(aiAudioAnimationRef.current)
          aiAudioAnimationRef.current = null
        }

        setConversationState('idle')
        setAudioStartTime(null) // Clear audio timing when AI finishes speaking
        setHasInterrupted(false) // Reset interruption flag when AI finishes

        // Speech recognition should already be running from the responding phase
        // But ensure it's active just in case
        if (!isMuted && recognitionRef.current) {
          if (recognitionRef.current.state !== 'active') {
            setTimeout(() => {
              if (recognitionRef.current && !isMuted) {
                try {
                  recognitionRef.current.start()
                  logger.info('🎤 Ensuring speech recognition is active after AI response')
                } catch (error: any) {
                  if (!error.message?.includes('already started')) {
                    logger.error('Error ensuring recognition is active:', error)
                  }
                }
              }
            }, 100)
          }
        }
      }
    }
  }, [isPlayingAudio, isStreaming, conversationState, isMuted])

  // Initialize when component mounts
  useEffect(() => {
    if (isSupported) {
      initializeSpeechRecognition()

      // Setup audio visualization immediately
      const initAudio = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // Aggressive echo cancellation settings
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 44100,
              channelCount: 1,
              // Enhanced echo cancellation for modern browsers
              suppressLocalAudioPlayback: true, // Modern browsers - suppress audio output feedback
              // Chrome-specific aggressive echo cancellation
              googEchoCancellation: true,
              googEchoCancellation2: true, // More advanced echo cancellation
              googAutoGainControl: true,
              googAutoGainControl2: true,
              googNoiseSuppression: true,
              googNoiseSuppression2: true,
              googHighpassFilter: true,
              googTypingNoiseDetection: true,
              googAudioMirroring: false, // Disable audio mirroring
              googAecExtendedFilter: true, // Extended echo cancellation filter
              // Additional echo suppression settings
              echoCancellationType: 'system', // Use system-level echo cancellation
            } as any,
          })

          setPermissionStatus('granted')
          mediaStreamRef.current = stream

          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
          const analyser = audioContext.createAnalyser()
          const microphone = audioContext.createMediaStreamSource(stream)

          analyser.fftSize = 1024
          analyser.smoothingTimeConstant = 0.3
          microphone.connect(analyser)

          audioContextRef.current = audioContext
          analyserRef.current = analyser

          const updateVisualization = () => {
            if (!analyserRef.current) return

            const bufferLength = analyserRef.current.frequencyBinCount
            const dataArray = new Uint8Array(bufferLength)
            analyserRef.current.getByteFrequencyData(dataArray)

            const levels: number[] = []
            const numPoints = 200

            for (let i = 0; i < numPoints; i++) {
              const dataIndex = Math.floor((i / numPoints) * bufferLength)
              const value = dataArray[dataIndex] || 0
              const normalizedValue = (value / 255) * 100
              levels.push(normalizedValue)
            }

            setAudioLevels(levels)
            animationFrameRef.current = requestAnimationFrame(updateVisualization)
          }

          updateVisualization()

          // Auto-start listening (will check mute state later)
          setTimeout(() => {
            setIsMuted((currentMuted) => {
              if (recognitionRef.current && !currentMuted) {
                try {
                  recognitionRef.current.start()
                  logger.info('🎤 Starting to listen for user input')
                } catch (error: any) {
                  if (!error.message?.includes('already started')) {
                    logger.error('Error starting recognition:', error)
                  }
                }
              }
              return currentMuted
            })
          }, 1000)
        } catch (error) {
          logger.error('Error setting up audio visualization:', error)
          setPermissionStatus('denied')
        }
      }

      initAudio()
    }
  }, [isSupported])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  const getStatusText = () => {
    if (isMuted) return 'Muted'
    switch (conversationState) {
      case 'listening':
        return 'Listening...'
      case 'responding':
        return isStreaming ? 'Thinking...' : 'Speaking...'
      default:
        return 'Ready'
    }
  }

  const isListening = conversationState === 'listening'

  return (
    <div className={cn('fixed inset-0 z-[100] flex flex-col bg-white text-gray-900', className)}>
      {/* Header with close button */}
      <div className='flex justify-end p-4'>
        <Button
          variant='ghost'
          size='icon'
          onClick={onCallEnd}
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
          <p className='font-light text-gray-600 text-lg'>{getStatusText()}</p>

          {/* Debug info in development */}
          {process.env.NODE_ENV === 'development' && (
            <div className='mt-2 space-y-1 text-gray-400 text-xs'>
              <p>
                State: {conversationState} | Permission: {permissionStatus}
              </p>
              <p>
                Audio Playing: {isPlayingAudio ? 'Yes' : 'No'} | Streaming:{' '}
                {isStreaming ? 'Yes' : 'No'}
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
            onClick={onCallEnd}
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
