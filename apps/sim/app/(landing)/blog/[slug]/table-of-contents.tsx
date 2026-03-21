'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { List } from 'lucide-react'

interface Heading {
  text: string
  id: string
}

interface TableOfContentsProps {
  headings: Heading[]
}

export function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>(headings[0]?.id ?? '')
  const observerRef = useRef<IntersectionObserver | null>(null)
  const isClickScrolling = useRef(false)
  const shouldReduceMotion = useReducedMotion()

  const setupObserver = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    const callback: IntersectionObserverCallback = (entries) => {
      if (isClickScrolling.current) return

      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

      if (visible.length > 0) {
        setActiveId(visible[0].target.id)
      }
    }

    observerRef.current = new IntersectionObserver(callback, {
      rootMargin: '-80px 0px -60% 0px',
      threshold: 0,
    })

    headings.forEach((heading) => {
      const el = document.getElementById(heading.id)
      if (el) observerRef.current?.observe(el)
    })
  }, [headings])

  useEffect(() => {
    setupObserver()
    return () => observerRef.current?.disconnect()
  }, [setupObserver])

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return

    isClickScrolling.current = true
    setActiveId(id)

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' })

    window.history.replaceState(null, '', `#${id}`)

    setTimeout(
      () => {
        isClickScrolling.current = false
      },
      prefersReducedMotion ? 50 : 800
    )
  }

  if (headings.length === 0) return null

  return (
    <div>
      <div className='mb-4 flex items-center gap-2 pb-2 font-season text-[11px] uppercase tracking-widest text-[#ECECEC]'>
        <List className='h-3 w-3 text-[#2ABBF8]' aria-hidden />
        Contents
      </div>
      <nav className='relative flex flex-col space-y-1 font-season text-[12px] font-medium text-[#999]'>
        {headings.map((h, idx) => {
          const isActive = activeId === h.id

          return (
            <a
              key={h.id}
              href={`#${h.id}`}
              onClick={(e) => handleClick(e, h.id)}
              className='relative flex items-center gap-2 rounded-[5px] px-2 py-1.5 transition-colors hover:text-[#ECECEC]'
              style={{ color: isActive ? '#2ABBF8' : undefined }}
            >
              {isActive && (
                <motion.span
                  layoutId='toc-highlight'
                  className='absolute inset-0 rounded-[5px] bg-[#2ABBF8]/10'
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : { type: 'spring', duration: 0.25, bounce: 0 }
                  }
                />
              )}
              <span className='relative z-10 text-[10px] opacity-50'>
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span className='relative z-10'>{h.text}</span>
            </a>
          )
        })}
      </nav>
    </div>
  )
}
