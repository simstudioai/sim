import { CirclePlay } from 'lucide-react'
import { cn } from '@/lib/utils'

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
              className='flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-fd-muted-foreground text-sm transition-colors hover:bg-fd-accent/50'
            >
              <CirclePlay className='size-4 shrink-0' />
              <span className='flex-1 truncate'>{chapter.title}</span>
              {chapter.time && (
                <span className='shrink-0 text-fd-muted-foreground text-xs tabular-nums'>
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
