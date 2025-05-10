'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Pause, Play } from 'lucide-react'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('AudioPlayer')

interface AudioPlayerProps {
  audioUrl: string
}

export function AudioPlayer({ audioUrl }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl)

      audioRef.current.addEventListener('ended', () => setIsPlaying(false))
      audioRef.current.addEventListener('pause', () => setIsPlaying(false))
      audioRef.current.addEventListener('play', () => setIsPlaying(true))
      audioRef.current.addEventListener('timeupdate', updateProgress)
    } else {
      audioRef.current.src = audioUrl
      setProgress(0)
    }

    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.removeEventListener('ended', () => setIsPlaying(false))
        audioRef.current.removeEventListener('pause', () => setIsPlaying(false))
        audioRef.current.removeEventListener('play', () => setIsPlaying(true))
        audioRef.current.removeEventListener('timeupdate', updateProgress)
      }
    }
  }, [audioUrl])

  const updateProgress = () => {
    if (audioRef.current) {
      const value = (audioRef.current.currentTime / audioRef.current.duration) * 100
      setProgress(isNaN(value) ? 0 : value)
    }
  }

  const togglePlay = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
  }

  const downloadAudio = async () => {
    try {
      const response = await fetch(audioUrl)
      const blob = await response.blob()

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `tts-audio-${Date.now()}.mp3`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Error downloading audio:', error)
    }
  }

  const seekAudio = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return

    const container = e.currentTarget
    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = x / rect.width

    audioRef.current.currentTime = percent * audioRef.current.duration
  }

  return (
    <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-background/40 w-full max-w-xs">
      <button
        className="inline-flex items-center justify-center h-7 w-7 bg-primary/10 hover:bg-primary/20 text-primary rounded-full transition-colors"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
      </button>

      <div
        className="flex-grow h-1.5 bg-muted rounded-full overflow-hidden cursor-pointer"
        onClick={seekAudio}
      >
        <div className="h-full bg-primary/40 rounded-full" style={{ width: `${progress}%` }} />
      </div>

      <button
        className="inline-flex items-center justify-center h-6 w-6 text-muted-foreground hover:text-foreground transition-colors"
        onClick={downloadAudio}
        aria-label="Download audio"
      >
        <Download className="h-3 w-3" />
      </button>
    </div>
  )
}
