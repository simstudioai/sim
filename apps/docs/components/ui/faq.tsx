'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FAQItem {
  question: string
  answer: string
}

interface FAQProps {
  items: FAQItem[]
  title?: string
}

function FAQItemRow({
  item,
  isOpen,
  onToggle,
}: {
  item: FAQItem
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type='button'
        onClick={onToggle}
        aria-expanded={isOpen}
        className='flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left font-[470] text-[0.875rem] text-[rgba(0,0,0,0.8)] transition-colors hover:bg-[rgba(0,0,0,0.02)] dark:text-[rgba(255,255,255,0.85)] dark:hover:bg-[rgba(255,255,255,0.03)]'
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-[rgba(0,0,0,0.3)] transition-transform duration-200 dark:text-[rgba(255,255,255,0.3)]',
            isOpen && 'rotate-90'
          )}
        />
        {item.question}
      </button>
      <div
        className='grid transition-[grid-template-rows,opacity] duration-200 ease-in-out'
        style={{
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div className='overflow-hidden'>
          <div className='px-4 pt-2 pb-2.5 pl-11 text-[0.875rem] text-[rgba(0,0,0,0.7)] leading-relaxed dark:text-[rgba(255,255,255,0.7)]'>
            {item.answer}
          </div>
        </div>
      </div>
    </div>
  )
}

export function FAQ({ items, title = 'Common Questions' }: FAQProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }

  return (
    <div className='mt-12'>
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <h2 className='mb-4 font-[500] text-xl'>{title}</h2>
      <div className='border-[rgba(0,0,0,0.08)] border-t border-b dark:border-[rgba(255,255,255,0.08)]'>
        {items.map((item, index) => (
          <div
            key={index}
            className={cn(
              index !== items.length - 1 &&
                'border-[rgba(0,0,0,0.08)] border-b dark:border-[rgba(255,255,255,0.08)]'
            )}
          >
            <FAQItemRow
              item={item}
              isOpen={openIndex === index}
              onToggle={() => setOpenIndex(openIndex === index ? null : index)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
