'use client'

import { useId, useState } from 'react'
import { ChevronRight } from '@sim/emcn/icons'
import Script from 'next/script'
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
        className='flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left font-medium text-[var(--text-body)] text-sm transition-colors hover:bg-[var(--surface-active)]'
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
          <div className='px-4 pt-2 pb-2.5 pl-11 text-[var(--text-secondary)] text-sm leading-relaxed'>
            {item.answer}
          </div>
        </div>
      </div>
    </div>
  )
}

export function FAQ({ items, title = 'Common Questions' }: FAQProps) {
  const structuredDataId = useId()
  /**
   * Rows open independently rather than as a single-open accordion. Auto-closing
   * a sibling collapses content *above* the row being opened, which yanks that
   * row out from under the pointer — and since the FAQ is the last block on the
   * page, the shrinking document also clamps the scroll position and lurches the
   * whole viewport. Opening a row now only ever pushes content below it down.
   */
  const [openIndices, setOpenIndices] = useState<ReadonlySet<number>>(() => new Set())

  const toggle = (index: number) =>
    setOpenIndices((previous) => {
      const next = new Set(previous)
      if (!next.delete(index)) next.add(index)
      return next
    })

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
      <Script
        id={`faq-json-ld-${structuredDataId}`}
        type='application/ld+json'
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqSchema) }}
      />
      <h2 className='mb-4 font-medium text-xl'>{title}</h2>
      <div className='border-[var(--border)] border-t border-b'>
        {items.map((item, index) => (
          <div
            key={item.question}
            className={cn(index !== items.length - 1 && 'border-[var(--border)] border-b')}
          >
            <FAQItemRow
              item={item}
              isOpen={openIndices.has(index)}
              onToggle={() => toggle(index)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
