'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

interface FAQItem {
  question: string
  answer: string
}

interface FAQProps {
  items: FAQItem[]
  title?: string
}

export function FAQ({ items, title = 'Common Questions' }: FAQProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div className='mt-12'>
      <h2 className='mb-4 font-bold text-xl'>{title}</h2>
      <div className='rounded-xl border border-border'>
        {items.map((item, index) => (
          <div key={index} className={index !== items.length - 1 ? 'border-border border-b' : ''}>
            <button
              type='button'
              onClick={() => setOpenIndex(openIndex === index ? null : index)}
              className='flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left font-medium text-[0.9375rem]'
            >
              <ChevronRight
                className={`h-4 w-4 shrink-0 text-fd-muted-foreground transition-transform duration-200 ${
                  openIndex === index ? 'rotate-90' : ''
                }`}
              />
              {item.question}
            </button>
            {openIndex === index && (
              <div className='px-5 pb-4 pl-12 text-[0.9375rem] text-fd-muted-foreground leading-relaxed'>
                {item.answer}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
