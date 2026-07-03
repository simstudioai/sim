'use client'

import { useEffect, useState } from 'react'
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
 * Right-rail list of the current video's chapters — flat and borderless to
 * match the docs' "On this page" TOC (small muted label, hover-highlighted
 * rows). Rows are skip-to controls; they activate once the lesson's video is
 * recorded.
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
    <aside className={cn('not-prose', className)}>
      <p className='mb-2 px-2.5 font-medium text-[0.8125rem] text-[var(--text-muted)]'>{title}</p>
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
              className='flex w-full cursor-pointer items-baseline gap-3 rounded-lg px-2.5 py-2 text-left text-[var(--text-secondary)] text-sm transition-colors hover:bg-[var(--surface-active)] disabled:cursor-default disabled:hover:bg-transparent'
            >
              <span className='min-w-0 flex-1 break-words'>{chapter.title}</span>
              {chapter.time && (
                <span className='shrink-0 text-[var(--text-muted)] text-xs tabular-nums'>
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
