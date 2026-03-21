'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Heading {
  text: string
  id: string
}

interface TableOfContentsProps {
  headings: Heading[]
}

export function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('')
  const observerRef = useRef<IntersectionObserver | null>(null)

  const setupObserver = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    const callback: IntersectionObserverCallback = (entries) => {
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

  const currentId = activeId || headings[0]?.id || ''

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' })

    window.history.replaceState(null, '', `#${id}`)
    setActiveId(id)
  }

  if (headings.length === 0) return null

  return (
    <div>
      <div className='mb-4 flex items-center gap-2 border-b border-[#2A2A2A] pb-3 font-mono text-[11px] uppercase tracking-widest text-[#ECECEC]'>
        <svg
          className='h-3 w-3 text-[#2ABBF8]'
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
          aria-hidden='true'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={2}
            d='M4 6h16M4 12h16M4 18h7'
          />
        </svg>
        Outline
      </div>
      <nav className='flex flex-col space-y-2 font-mono text-[12px] font-medium text-[#999]'>
        {headings.map((h, idx) => {
          const isActive = currentId === h.id

          return (
            <a
              key={h.id}
              href={`#${h.id}`}
              onClick={(e) => handleClick(e, h.id)}
              className={`flex items-center gap-2 rounded-[5px] px-2 py-1.5 transition-colors ${
                isActive
                  ? 'bg-[#2ABBF8]/10 text-[#2ABBF8]'
                  : 'hover:bg-[#2A2A2A]/50 hover:text-[#ECECEC]'
              }`}
            >
              <span className='text-[10px] opacity-50'>{String(idx + 1).padStart(2, '0')}</span>
              {h.text}
            </a>
          )
        })}
      </nav>
    </div>
  )
}
