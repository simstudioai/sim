import { cn } from '@/lib/utils'

interface LearnItem {
  title: string
  body: string
}

interface WhatYouWillLearnProps {
  items: LearnItem[]
  className?: string
}

/** A bordered "What you will learn" card listing lesson takeaways. */
export function WhatYouWillLearn({ items, className }: WhatYouWillLearnProps) {
  return (
    <div
      className={cn(
        'not-prose rounded-xl border border-[var(--border-1)] bg-[var(--surface-3)] p-6',
        className
      )}
    >
      <h2 className='mt-0 mb-5 font-semibold text-[var(--text-primary)] text-xl'>
        What you will learn
      </h2>
      <div className='flex flex-col gap-5'>
        {items.map((item) => (
          <div key={item.title}>
            <p className='mb-1 font-semibold text-[var(--text-primary)] text-sm'>{item.title}</p>
            <p className='m-0 text-[var(--text-secondary)] text-sm leading-relaxed'>{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
