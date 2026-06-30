'use client'

import { useId, useState } from 'react'
import { ChevronDown, cn } from '@sim/emcn'
import { domAnimation, LazyMotion, m } from 'framer-motion'

interface LandingFAQItem {
  question: string
  answer: string
}

interface LandingFAQProps {
  faqs: LandingFAQItem[]
}

/**
 * Accordion FAQ for landing pages. Answers stay mounted (collapsed via
 * animated height) so non-JS crawlers see the full Q&A text and FAQPage
 * JSON-LD always matches visible content.
 */
export function LandingFAQ({ faqs }: LandingFAQProps) {
  const baseId = useId()
  const [openIndex, setOpenIndex] = useState<number | null>(0)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  return (
    <LazyMotion features={domAnimation}>
      <div>
        {faqs.map(({ question, answer }, index) => {
          const isOpen = openIndex === index
          const showDivider = index > 0 && hoveredIndex !== index && hoveredIndex !== index - 1
          const panelId = `${baseId}-faq-panel-${index}`

          return (
            <div key={question}>
              <div
                className={cn(
                  'h-px w-full bg-[var(--border)]',
                  index === 0 || !showDivider ? 'invisible' : 'visible'
                )}
              />
              <h3>
                <button
                  type='button'
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className='-mx-6 flex w-[calc(100%+3rem)] items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-[var(--surface-hover)]'
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                >
                  <span
                    className={cn(
                      'text-[15px] leading-snug tracking-[-0.02em] transition-colors',
                      isOpen
                        ? 'text-[var(--text-primary)]'
                        : 'text-[var(--text-body)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {question}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform duration-200',
                      isOpen ? 'rotate-180' : 'rotate-0'
                    )}
                    aria-hidden='true'
                  />
                </button>
              </h3>

              <m.div
                id={panelId}
                initial={false}
                animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className='overflow-hidden'
                aria-hidden={!isOpen}
              >
                <div className='pt-2 pb-4'>
                  <p className='text-[14px] text-[var(--text-body)] leading-[1.75]'>{answer}</p>
                </div>
              </m.div>
            </div>
          )
        })}
      </div>
    </LazyMotion>
  )
}
