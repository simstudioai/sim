'use client'

import { useEffect } from 'react'

/** Reveals deep-linked content after navigation, including nested native disclosures. */
export function ContentInteractions() {
  useEffect(() => {
    function reveal() {
      let target: HTMLElement | null
      try {
        target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
      } catch {
        return
      }
      if (!target) return
      let parent = target.parentElement
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true
        parent = parent.parentElement
      }
      requestAnimationFrame(() =>
        requestAnimationFrame(() => target?.scrollIntoView({ block: 'start' }))
      )
    }
    reveal()
    window.addEventListener('hashchange', reveal)
    return () => window.removeEventListener('hashchange', reveal)
  }, [])
  return null
}
