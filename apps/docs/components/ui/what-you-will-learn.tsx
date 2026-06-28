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
 * "What you will learn" — a flat, divider-based callout matching the docs'
 * card-flattening language (transparent, no filled box, like the FAQ list),
 * with a small label at the app's panel-title scale rather than page-h2 scale.
 */
export function WhatYouWillLearn({ items, className }: WhatYouWillLearnProps) {
  return (
    <div className={cn('not-prose', className)}>
      <p className='mb-3 font-medium text-[var(--text-primary)] text-sm'>What you will learn</p>
      <div className='border-[var(--border)] border-t'>
        {items.map((item) => (
          <div key={item.title} className='border-[var(--border)] border-b py-3.5'>
            <p className='mb-1 font-medium text-[var(--text-primary)] text-sm'>{item.title}</p>
            <p className='m-0 text-[var(--text-secondary)] text-sm leading-relaxed'>{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
