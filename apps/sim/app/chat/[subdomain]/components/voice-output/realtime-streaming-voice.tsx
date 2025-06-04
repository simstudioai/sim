'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Volume2, VolumeX } from 'lucide-react'

interface RealtimeStreamingVoiceProps {
  text: string
  voiceId?: string
  autoPlay?: boolean
  isStreaming?: boolean
  onPlayStart?: () => void
  onPlayEnd?: () => void
  onError?: (error: Error) => void
}

// Chunk size for processing text (sentences or meaningful chunks)
const CHUNK_DELIMITER = /[.!?]+\s+/g

export function RealtimeStreamingVoice({
  text,
  voiceId = 'EXAVITQu4vr4xnSDxMaL',
  autoPlay = false,
  isStreaming = false,
  onPlayStart,
  onPlayEnd,
  onError,
}: RealtimeStreamingVoiceProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasUserInteracted, setHasUserInteracted] = useState(false)
  const [queuedAudioCount, setQueuedAudioCount] = useState(0)

  const audioQueueRef = useRef<HTMLAudioElement[]>([])
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const processedTextRef = useRef<string>('')
  const isProcessingRef = useRef(false)
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  // Split text into chunks for processing
  const getUnprocessedChunks = useCallback(
    (fullText: string): string[] => {
      const processedLength = processedTextRef.current.length
      const unprocessedText = fullText.slice(processedLength)

      if (!unprocessedText) return []

      // Split by sentence endings
      const chunks = unprocessedText.split(CHUNK_DELIMITER).filter((chunk) => chunk.trim())

      // If no sentence endings found, check if we have enough text for a chunk
      if (chunks.length === 0 && unprocessedText.length > 50 && !isStreaming) {
        return [unprocessedText]
      }

      // Only return complete sentences unless streaming has ended
      if (isStreaming && chunks.length > 0) {
        // Keep the last chunk if it doesn't end with punctuation (incomplete sentence)
        const lastChunk = chunks[chunks.length - 1]
        if (lastChunk && !lastChunk.match(/[.!?]$/)) {
          chunks.pop()
        }
      }

      return chunks
    },
    [isStreaming]
  )

  // Process a single text chunk
  const processChunk = useCallback(
    async (chunk: string, chunkIndex: number) => {
      if (!chunk.trim()) return null

      const chunkId = `chunk-${chunkIndex}-${Date.now()}`
      console.log(
        `🎵 RealtimeVoice: Processing chunk ${chunkIndex}:`,
        `${chunk.substring(0, 50)}...`
      )

      const abortController = new AbortController()
      abortControllersRef.current.set(chunkId, abortController)

      try {
        const response = await fetch('/api/proxy/tts/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: chunk,
            voiceId,
            modelId: 'eleven_turbo_v2', // Use turbo model for lower latency
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          throw new Error(`TTS failed for chunk ${chunkIndex}: ${response.status}`)
        }

        const audioBlob = await response.blob()
        const audioUrl = URL.createObjectURL(audioBlob)

        // Create audio element for this chunk
        const audio = new Audio(audioUrl)
        audio.preload = 'auto'

        // Mark this chunk as processed
        processedTextRef.current += chunk

        return audio
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error(`❌ RealtimeVoice: Error processing chunk ${chunkIndex}:`, err)
        }
        return null
      } finally {
        abortControllersRef.current.delete(chunkId)
      }
    },
    [voiceId]
  )

  // Play audio queue sequentially
  const playNextInQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      console.log('🏁 RealtimeVoice: Audio queue empty')
      setIsPlaying(false)
      setQueuedAudioCount(0)
      onPlayEnd?.()
      return
    }

    const audio = audioQueueRef.current.shift()!
    setQueuedAudioCount(audioQueueRef.current.length)
    currentAudioRef.current = audio

    audio.onended = () => {
      console.log('✅ RealtimeVoice: Chunk finished playing')
      URL.revokeObjectURL(audio.src)
      playNextInQueue()
    }

    audio.onerror = (e) => {
      console.error('❌ RealtimeVoice: Audio playback error:', e)
      URL.revokeObjectURL(audio.src)
      playNextInQueue() // Try next chunk
    }

    audio
      .play()
      .then(() => {
        console.log('▶️ RealtimeVoice: Playing chunk')
        if (!isPlaying) {
          setIsPlaying(true)
          onPlayStart?.()
        }
      })
      .catch((err) => {
        console.error('❌ RealtimeVoice: Play failed:', err)
        if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
          setError('Click to play audio')
          audioQueueRef.current.unshift(audio) // Put it back
          setIsPlaying(false)
        } else {
          playNextInQueue() // Try next chunk
        }
      })
  }, [onPlayStart, onPlayEnd])

  // Process new chunks
  const processNewChunks = useCallback(async () => {
    if (isProcessingRef.current) return

    const chunks = getUnprocessedChunks(text)
    if (chunks.length === 0) return

    isProcessingRef.current = true
    setIsLoading(true)

    console.log(`🎯 RealtimeVoice: Processing ${chunks.length} new chunks`)

    try {
      // Process chunks in parallel for speed
      const audioPromises = chunks.map((chunk, index) =>
        processChunk(chunk, processedTextRef.current.length + index)
      )

      const audioElements = await Promise.all(audioPromises)

      // Add successfully processed audio to queue
      const validAudio = audioElements.filter((audio): audio is HTMLAudioElement => audio !== null)
      if (validAudio.length > 0) {
        audioQueueRef.current.push(...validAudio)
        setQueuedAudioCount(audioQueueRef.current.length)

        // Start playing if not already playing and auto-play is enabled
        if (!currentAudioRef.current && hasUserInteracted && autoPlay) {
          playNextInQueue()
        }
      }
    } finally {
      isProcessingRef.current = false
      setIsLoading(false)
    }
  }, [text, getUnprocessedChunks, processChunk, hasUserInteracted, autoPlay, playNextInQueue])

  // Toggle playback
  const togglePlayback = useCallback(() => {
    setHasUserInteracted(true)

    if (currentAudioRef.current && isPlaying) {
      // Pause current audio
      currentAudioRef.current.pause()
      setIsPlaying(false)
    } else if (audioQueueRef.current.length > 0 || currentAudioRef.current) {
      // Resume or start playing
      if (currentAudioRef.current) {
        currentAudioRef.current.play()
        setIsPlaying(true)
      } else {
        playNextInQueue()
      }
    } else {
      // Process text if nothing is ready
      processNewChunks()
    }
  }, [isPlaying, playNextInQueue, processNewChunks])

  // Process text changes
  useEffect(() => {
    // Debounce for streaming text
    const delay = isStreaming ? 500 : 100
    const timeoutId = setTimeout(() => {
      processNewChunks()
    }, delay)

    return () => clearTimeout(timeoutId)
  }, [text, isStreaming, processNewChunks])

  // Handle streaming end - process any remaining text
  useEffect(() => {
    if (!isStreaming && text && processedTextRef.current.length < text.length) {
      console.log('🏁 RealtimeVoice: Streaming ended, processing remaining text')
      processNewChunks()
    }
  }, [isStreaming, text, processNewChunks])

  // Enable auto-play after user interaction
  useEffect(() => {
    const enableAutoPlay = () => {
      setHasUserInteracted(true)
      console.log('🎯 RealtimeVoice: User interaction detected')
    }

    document.addEventListener('click', enableAutoPlay, { once: true })
    document.addEventListener('keydown', enableAutoPlay, { once: true })
    document.addEventListener('touchstart', enableAutoPlay, { once: true })

    return () => {
      document.removeEventListener('click', enableAutoPlay)
      document.removeEventListener('keydown', enableAutoPlay)
      document.removeEventListener('touchstart', enableAutoPlay)
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Abort all ongoing requests
      abortControllersRef.current.forEach((controller) => controller.abort())

      // Stop and clean up all audio
      if (currentAudioRef.current) {
        currentAudioRef.current.pause()
        URL.revokeObjectURL(currentAudioRef.current.src)
      }

      audioQueueRef.current.forEach((audio) => {
        URL.revokeObjectURL(audio.src)
      })
    }
  }, [])

  if (!text || text.length < 10) {
    return null
  }

  return (
    <div className='flex items-center space-x-2'>
      <button
        type='button'
        onClick={togglePlayback}
        disabled={isLoading && audioQueueRef.current.length === 0}
        className={`flex items-center justify-center rounded-full p-2 transition-all duration-200 ${
          isPlaying
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        } ${isLoading && audioQueueRef.current.length === 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} `}
        title={
          error
            ? `Error: ${error}`
            : isLoading
              ? 'Processing audio...'
              : isPlaying
                ? 'Pause audio'
                : 'Play audio'
        }
      >
        {isLoading && audioQueueRef.current.length === 0 ? (
          <Loader2 size={16} className='animate-spin' />
        ) : isPlaying ? (
          <VolumeX size={16} />
        ) : (
          <Volume2 size={16} />
        )}
      </button>

      {/* Queue indicator */}
      {queuedAudioCount > 0 && (
        <span className='text-gray-500 text-xs'>
          {queuedAudioCount} {isStreaming ? 'chunks ready' : 'in queue'}
        </span>
      )}

      {/* Audio Waveform Visualization */}
      <AnimatePresence>
        {isPlaying && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className='flex items-center space-x-1'
          >
            {[1, 2, 3, 4, 5].map((i) => (
              <motion.div
                key={i}
                className='w-1 rounded-full bg-blue-500'
                animate={{
                  height: [4, 12, 4],
                }}
                transition={{
                  duration: 0.6,
                  repeat: Number.POSITIVE_INFINITY,
                  delay: i * 0.1,
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Display */}
      {error && (
        <span className='cursor-help text-red-500 text-sm' title={error}>
          ⚠️
        </span>
      )}
    </div>
  )
}
