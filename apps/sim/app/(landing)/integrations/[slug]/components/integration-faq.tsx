'use client'

import { useState } from 'react'
import { ChevronDown } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { FAQItem } from '@/app/(landing)/integrations/data/types'

interface IntegrationFAQProps {
  faqs: FAQItem[]
}

export function IntegrationFAQ({ faqs }: IntegrationFAQProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <div className='divide-y divide-[var(--landing-border)]'>
      {faqs.map(({ question, answer }, index) => {
        const isOpen = openIndex === index
        return (
          <div key={question}>
            <button
              type='button'
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className='flex w-full items-start justify-between gap-4 py-5 text-left'
              aria-expanded={isOpen}
            >
              <span
                className={cn(
                  'font-[500] text-[15px] leading-snug transition-colors',
                  isOpen
                    ? 'text-[var(--landing-text)]'
                    : 'text-[var(--landing-text-muted)] hover:text-[var(--landing-text)]'
                )}
              >
                {question}
              </span>
              <ChevronDown
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 text-[#555] transition-transform duration-200',
                  isOpen ? 'rotate-180' : 'rotate-0'
                )}
                aria-hidden='true'
              />
            </button>

            {isOpen && (
              <div className='pb-5'>
                <p className='text-[14px] text-[var(--landing-text-muted)] leading-[1.75]'>
                  {answer}
                </p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
