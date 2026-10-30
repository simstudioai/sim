'use client'

import { useEffect, useState } from 'react'
import type { DocsHeading } from '@/lib/content/types'

/** One scroll position drives every responsive view of the current article's outline. */
export function useActiveHeading(headings: DocsHeading[]) {
  const [active, setActive] = useState<string | undefined>(headings[0]?.id)
  useEffect(() => {
    const elements = headings
      .map(({ id }) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const visible = elements.filter((element) => element.getClientRects().length > 0)
        const offset =
          Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
        const previous = visible.filter(
          (element) => element.getBoundingClientRect().top <= offset + 1
        )
        const atEnd =
          window.scrollY > 0 &&
          window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1
        setActive((atEnd ? visible.at(-1) : (previous.at(-1) ?? visible[0]))?.id)
      })
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('hashchange', update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update)
      window.removeEventListener('hashchange', update)
      window.removeEventListener('resize', update)
    }
  }, [headings])
  return active
}
