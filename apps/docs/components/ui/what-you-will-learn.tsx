import { cn } from '@/lib/utils'

interface LearnItem {
  title: string
  body: string
}

interface WhatYouWillLearnProps {
  items: LearnItem[]
  className?: string
}

/**
 * "What you will learn" — a flat callout matching the docs' flat/divider
 * language. A quiet muted label (like the TOC heading) sits above the
 * takeaways; dividers fall only between items, so the label reads as a marker
 * rather than an underlined heading and never competes with the item titles.
 */
export function WhatYouWillLearn({ items, className }: WhatYouWillLearnProps) {
  return (
    <div className={cn('not-prose', className)}>
      <p className='mb-3 font-medium text-[0.8125rem] text-[var(--text-muted)]'>
        What you will learn
      </p>
      <div className='divide-y divide-[var(--border)]'>
        {items.map((item) => (
          <div key={item.title} className='py-3.5 first:pt-0 last:pb-0'>
            <p className='mb-1 font-medium text-[var(--text-primary)] text-sm'>{item.title}</p>
            <p className='m-0 text-[var(--text-secondary)] text-sm leading-relaxed'>{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
