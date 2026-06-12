'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { serializeJsonLd } from '@/lib/json-ld'
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
        className='flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left font-[470] text-[0.875rem] text-[var(--text-body)] transition-colors hover:bg-[var(--surface-3)]'
      >
        <ChevronRight
          className={cn(
            'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform duration-200',
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
          <div className='px-4 pt-2 pb-2.5 pl-11 text-[0.875rem] text-[var(--text-secondary)] leading-relaxed'>
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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqSchema) }}
      />
      <h2 className='mb-4 font-[500] text-xl'>{title}</h2>
      <div className='border-[var(--border)] border-t border-b'>
        {items.map((item, index) => (
          <div
            key={item.question}
            className={cn(index !== items.length - 1 && 'border-[var(--border)] border-b')}
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
