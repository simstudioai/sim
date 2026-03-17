'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import Link from 'next/link'

interface CategoryItem {
  id: string | null
  label: string
  count: number
  href: string
  color: string
}

interface CategoryListProps {
  items: CategoryItem[]
  activeId: string | null
}

const ROW_H = 38

export function CategoryList({ items, activeId }: CategoryListProps) {
  const shouldReduceMotion = useReducedMotion()
  const listRef = useRef<HTMLUListElement>(null)
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map())
  const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null)

  const activeIndex = items.findIndex((item) => item.id === activeId)
  const activeItem = activeIndex >= 0 ? items[activeIndex] : null

  useEffect(() => {
    const key = activeId ?? 'all'
    const el = itemRefs.current.get(key)
    const list = listRef.current
    if (!el || !list) {
      setHighlight(null)
      return
    }
    const listRect = list.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    setHighlight({
      top: elRect.top - listRect.top,
      height: elRect.height,
    })
  }, [activeId])

  return (
    <ul ref={listRef} className='relative flex flex-col'>
      {activeItem && highlight && (
        <motion.div
          className='absolute left-0 right-0 rounded-sm'
          style={{
            backgroundColor: `${activeItem.color}0D`,
            border: `1px solid ${activeItem.color}`,
            height: highlight.height,
          }}
          animate={{ y: highlight.top }}
          transition={
            shouldReduceMotion ? { duration: 0 } : { type: 'spring', duration: 0.3, bounce: 0 }
          }
        />
      )}

      {items.map((item) => {
        const isActive = item.id === activeId
        const key = item.id ?? 'all'

        return (
          <li
            key={key}
            ref={(el) => {
              if (el) itemRefs.current.set(key, el)
            }}
          >
            <Link
              href={item.href}
              className={`relative flex items-center justify-between rounded-sm px-3 py-2 text-[13px] transition-colors duration-150 ease ${
                isActive
                  ? ''
                  : '[@media(hover:hover)]:hover:bg-[#232323] [@media(hover:hover)]:hover:text-[#ECECEC]'
              }`}
              style={{ color: isActive ? item.color : '#999' }}
            >
              <span className='relative z-10'>{item.label}</span>
              <span
                className='relative z-10 font-mono text-[10px]'
                style={{
                  padding: '2px 6px',
                  borderRadius: '2px',
                  border: isActive ? `1px solid ${item.color}` : '1px solid #2A2A2A',
                  color: isActive ? item.color : '#666',
                }}
              >
                {String(item.count).padStart(2, '0')}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
