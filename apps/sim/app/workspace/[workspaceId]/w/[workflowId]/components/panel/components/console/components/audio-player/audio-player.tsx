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
      setProgress(Number.isNaN(value) ? 0 : value)
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
    <div className='mt-2 flex w-full max-w-xs items-center gap-2 rounded-md bg-background/40 p-2'>
      <button
        className='inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20'
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause className='h-3.5 w-3.5' /> : <Play className='ml-0.5 h-3.5 w-3.5' />}
      </button>

      <div
        className='h-1.5 flex-grow cursor-pointer overflow-hidden rounded-full bg-muted'
        onClick={seekAudio}
      >
        <div className='h-full rounded-full bg-primary/40' style={{ width: `${progress}%` }} />
      </div>

      <button
        className='inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground'
        onClick={downloadAudio}
        aria-label='Download audio'
      >
        <Download className='h-3 w-3' />
      </button>
    </div>
  )
}
