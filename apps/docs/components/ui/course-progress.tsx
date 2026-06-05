import { BookOpen, Check, CirclePlay, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Lesson {
  title: string
  /** e.g. "4:12". Omit to show "View" instead. */
  duration?: string
  /** Highlights the current lesson. */
  active?: boolean
  /** Renders a completed checkmark. */
  done?: boolean
}

interface CourseProgressProps {
  /** Course name shown as the panel heading. */
  course: string
  lessons: Lesson[]
  /** e.g. "Approx. 18 min". */
  durationLabel?: string
  /** Completion percentage 0–100. */
  progress?: number
  className?: string
}

/** Right-rail course panel: lesson count, duration, progress bar, and lesson list. */
export function CourseProgress({
  course,
  lessons,
  durationLabel,
  progress = 0,
  className,
}: CourseProgressProps) {
  return (
    <aside className={cn('rounded-xl border border-fd-border bg-fd-card/40 p-5', className)}>
      <h2 className='mt-0 mb-3 font-semibold text-fd-foreground text-lg'>{course}</h2>

      <div className='flex flex-wrap items-center gap-2 border-fd-border border-b pb-4 text-fd-muted-foreground text-xs'>
        <span className='inline-flex items-center gap-1.5 rounded-md border border-fd-border px-2 py-1'>
          <BookOpen className='size-3.5' />
          {lessons.length} lessons
        </span>
        {durationLabel && (
          <span className='inline-flex items-center gap-1.5 rounded-md border border-fd-border px-2 py-1'>
            <Clock className='size-3.5' />
            {durationLabel}
          </span>
        )}
      </div>

      <div className='py-4'>
        <div className='mb-2 flex items-center justify-between text-sm'>
          <span className='text-fd-foreground'>Your progress</span>
          <span className='text-fd-muted-foreground'>{progress}%</span>
        </div>
        <div className='h-1.5 w-full overflow-hidden rounded-full bg-fd-muted'>
          <div
            className='h-full rounded-full bg-[#33c482] transition-all'
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      </div>

      <ul className='m-0 flex list-none flex-col gap-0.5 p-0'>
        {lessons.map((lesson) => (
          <li
            key={lesson.title}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
              lesson.active
                ? 'bg-fd-accent text-fd-foreground'
                : 'text-fd-muted-foreground hover:bg-fd-accent/50'
            )}
          >
            {lesson.done ? (
              <Check className='size-4 shrink-0 text-[#33c482]' />
            ) : (
              <CirclePlay
                className={cn('size-4 shrink-0', lesson.active && 'text-fd-foreground')}
              />
            )}
            <span className={cn('flex-1 truncate', lesson.active && 'font-medium')}>
              {lesson.title}
            </span>
            <span className='shrink-0 text-fd-muted-foreground text-xs tabular-nums'>
              {lesson.duration ?? 'View'}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
