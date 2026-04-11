'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

export interface LandingFAQItem {
  question: string
  answer: string
}

interface LandingFAQProps {
  faqs: LandingFAQItem[]
}

export function LandingFAQ({ faqs }: LandingFAQProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  return (
    <div>
      {faqs.map(({ question, answer }, index) => {
        const isOpen = openIndex === index
        const isHovered = hoveredIndex === index
        const showDivider = index > 0 && hoveredIndex !== index && hoveredIndex !== index - 1

        return (
          <div key={question}>
            <div
              className={cn(
                'h-px w-full bg-[var(--landing-bg-elevated)]',
                index === 0 || !showDivider ? 'invisible' : 'visible'
              )}
            />
            <button
              type='button'
              onClick={() => setOpenIndex(isOpen ? null : index)}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className='-mx-6 flex w-[calc(100%+3rem)] items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-[var(--landing-bg-elevated)]'
              aria-expanded={isOpen}
            >
              <span
                className={cn(
                  'text-[15px] leading-snug tracking-[-0.02em] transition-colors',
                  isOpen
                    ? 'text-[var(--landing-text)]'
                    : 'text-[var(--landing-text-body)] hover:text-[var(--landing-text)]'
                )}
              >
                {question}
              </span>
              <ChevronDown
                className={cn(
                  'h-3 w-3 shrink-0 text-[var(--landing-text-subtle)] transition-transform duration-200',
                  isOpen ? 'rotate-180' : 'rotate-0'
                )}
                aria-hidden='true'
              />
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  className='overflow-hidden'
                >
                  <div className='pt-2 pb-4'>
                    <p className='text-[14px] text-[var(--landing-text-body)] leading-[1.75]'>
                      {answer}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}
