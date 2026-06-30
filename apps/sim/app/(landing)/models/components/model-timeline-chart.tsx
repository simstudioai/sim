import Link from 'next/link'
import { getProviderColor } from '@/app/(landing)/models/components/constants'
import type { CatalogModel } from '@/app/(landing)/models/utils'

function formatShortDate(date: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(date))
  } catch {
    return date
  }
}

interface ModelTimelineChartProps {
  models: CatalogModel[]
  providerId: string
}

const ITEM_WIDTH = 150

export function ModelTimelineChart({ models, providerId }: ModelTimelineChartProps) {
  const entries = models
    .filter((m) => m.releaseDate !== null)
    .map((m) => ({
      model: m,
      date: new Date(m.releaseDate as string),
      dateStr: m.releaseDate as string,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (entries.length === 0) return null

  const color = getProviderColor(providerId)

  return (
    <section aria-labelledby='timeline-heading'>
      <div className='px-6 pt-10 pb-4'>
        <h2
          id='timeline-heading'
          className='mb-2 text-[20px] text-[var(--text-primary)] leading-[100%] tracking-[-0.02em] lg:text-[24px]'
        >
          Release timeline
        </h2>
        <p className='text-[var(--text-muted)] text-sm leading-[150%] tracking-[0.02em]'>
          When each model was first publicly available.
        </p>
      </div>

      <div className='overflow-x-auto px-6 pb-8'>
        {/* Fixed height: top labels + line + bottom labels */}
        <div
          className='relative h-[140px]'
          style={{ minWidth: `${entries.length * ITEM_WIDTH}px` }}
        >
          {/* Horizontal line - vertically centered */}
          <div className='absolute top-[70px] right-0 left-0 h-px bg-[var(--border-1)]' />

          {entries.map(({ model, dateStr }, i) => {
            const left = i * ITEM_WIDTH + ITEM_WIDTH / 2
            const isAbove = i % 2 === 0

            return (
              <Link
                key={model.id}
                href={model.href}
                className='group absolute flex flex-col items-center'
                style={{
                  left: `${left}px`,
                  width: `${ITEM_WIDTH}px`,
                  marginLeft: `${-ITEM_WIDTH / 2}px`,
                  top: 0,
                  height: '100%',
                }}
              >
                {/* Dot - centered exactly on the line (70px - 6px). Resting at 85%
                    opacity, hover lifts it to full with a slight scale — an
                    understated, opacity-driven hover matching the comparison
                    chart, so it reads as a clean accent rather than a jump. */}
                <div
                  className='-translate-x-1/2 absolute top-[64px] left-1/2 size-[12px] rounded-full opacity-[0.85] transition-[opacity,transform] duration-150 group-hover:scale-110 group-hover:opacity-100'
                  style={{ backgroundColor: color }}
                />

                {/* Stem + label above */}
                {isAbove && (
                  <div className='-translate-x-1/2 absolute bottom-[74px] left-1/2 flex flex-col items-center'>
                    <div className='flex flex-col items-center gap-0.5 pb-1.5'>
                      <span className='whitespace-nowrap text-[12px] text-[var(--text-primary)] leading-none tracking-[-0.01em] transition-colors group-hover:text-[var(--text-primary)]'>
                        {model.displayName}
                      </span>
                      <span className='whitespace-nowrap text-[10px] text-[var(--text-muted)] leading-none'>
                        {formatShortDate(dateStr)}
                      </span>
                    </div>
                    <div
                      className='w-px'
                      style={{ height: '10px', backgroundColor: color, opacity: 0.2 }}
                    />
                  </div>
                )}

                {/* Stem + label below */}
                {!isAbove && (
                  <div className='-translate-x-1/2 absolute top-[75px] left-1/2 flex flex-col items-center'>
                    <div
                      className='w-px'
                      style={{ height: '10px', backgroundColor: color, opacity: 0.2 }}
                    />
                    <div className='flex flex-col items-center gap-0.5 pt-1.5'>
                      <span className='whitespace-nowrap text-[12px] text-[var(--text-primary)] leading-none tracking-[-0.01em] transition-colors group-hover:text-[var(--text-primary)]'>
                        {model.displayName}
                      </span>
                      <span className='whitespace-nowrap text-[10px] text-[var(--text-muted)] leading-none'>
                        {formatShortDate(dateStr)}
                      </span>
                    </div>
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
