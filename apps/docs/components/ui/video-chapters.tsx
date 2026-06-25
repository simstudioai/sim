'use client'

import { useEffect, useState } from 'react'
import { CirclePlay } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Parse a chapter timestamp ("M:SS" or "H:MM:SS") into seconds. */
function parseTime(time: string): number {
  const parts = time.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

interface Chapter {
  /** Chapter label. */
  title: string
  /** Timestamp, e.g. "0:45". */
  time?: string
}

interface VideoChaptersProps {
  /** Panel heading. Defaults to "Chapters". */
  title?: string
  chapters: Chapter[]
  className?: string
}

/**
 * Right-rail panel listing the current video's chapters, styled to match the
 * Academy's course panels. Rows are skip-to controls; they activate once the
 * lesson's video is recorded.
 */
export function VideoChapters({ title = 'Chapters', chapters, className }: VideoChaptersProps) {
  // Chapters only seek when a VideoPlaceholder with a real video is on the page.
  // Handshake so the rows stay inert (not falsely clickable) on video-less lessons.
  const [hasVideo, setHasVideo] = useState(false)
  useEffect(() => {
    const onReady = () => setHasVideo(true)
    window.addEventListener('academy:video-ready', onReady)
    window.dispatchEvent(new Event('academy:video-query'))
    return () => window.removeEventListener('academy:video-ready', onReady)
  }, [])

  return (
    <aside
      className={cn('not-prose rounded-xl border border-fd-border bg-fd-card/40 p-5', className)}
    >
      <h2 className='mt-0 mb-3 font-semibold text-fd-foreground text-lg'>{title}</h2>
      <ul className='m-0 flex list-none flex-col gap-0.5 p-0'>
        {chapters.map((chapter) => (
          <li key={chapter.title}>
            <button
              type='button'
              disabled={!hasVideo || chapter.time == null}
              onClick={() => {
                if (chapter.time == null) return
                window.dispatchEvent(
                  new CustomEvent('academy:seek', { detail: { time: parseTime(chapter.time) } })
                )
              }}
              className='flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-fd-muted-foreground text-sm transition-colors hover:bg-fd-accent/50 disabled:cursor-default disabled:hover:bg-transparent'
            >
              <CirclePlay className='mt-0.5 size-4 shrink-0' />
              <span className='min-w-0 flex-1 break-words'>{chapter.title}</span>
              {chapter.time && (
                <span className='mt-0.5 shrink-0 text-fd-muted-foreground text-xs tabular-nums'>
                  {chapter.time}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
