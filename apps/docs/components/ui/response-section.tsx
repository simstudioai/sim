'use client'

import { useEffect, useRef, useState } from 'react'
import { ChipSelect } from '@sim/emcn'

interface ResponseSectionProps {
  children: React.ReactNode
}

export function ResponseSection({ children }: ResponseSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [statusCodes, setStatusCodes] = useState<string[]>([])
  const [selectedCode, setSelectedCode] = useState<string>('')

  function getAccordionItems() {
    const root = containerRef.current?.querySelector('[data-orientation="vertical"]')
    if (!root) return []
    return Array.from(root.children).filter(
      (el) => el.getAttribute('data-state') !== null
    ) as HTMLElement[]
  }

  function showStatusCode(code: string) {
    const items = getAccordionItems()
    for (const item of items) {
      const triggerBtn = item.querySelector('h3 button') as HTMLButtonElement | null
      const text = triggerBtn?.textContent?.trim() ?? ''
      const itemCode = text.match(/^\d{3}/)?.[0]

      if (itemCode === code) {
        item.style.display = ''
        if (item.getAttribute('data-state') === 'closed' && triggerBtn) {
          triggerBtn.click()
        }
      } else {
        item.style.display = 'none'
        if (item.getAttribute('data-state') === 'open' && triggerBtn) {
          triggerBtn.click()
        }
      }
    }
  }

  /** Waits for the dependency's response accordion to mount before selecting a status. */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const initialize = () => {
      const items = getAccordionItems()
      if (items.length === 0) return false

      const codes: string[] = []
      const seen = new Set<string>()
      for (const item of items) {
        const triggerBtn = item.querySelector('h3 button')
        if (triggerBtn) {
          const text = triggerBtn.textContent?.trim() ?? ''
          const code = text.match(/^\d{3}/)?.[0]
          if (code && !seen.has(code)) {
            seen.add(code)
            codes.push(code)
          }
        }
      }
      if (codes.length > 0) {
        setStatusCodes(codes)
        setSelectedCode(codes[0])
        showStatusCode(codes[0])
        return true
      }
      return false
    }

    if (initialize()) return
    const observer = new MutationObserver(() => {
      if (initialize()) observer.disconnect()
    })
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  function handleSelectCode(code: string) {
    setSelectedCode(code)
    showStatusCode(code)
  }

  return (
    <div ref={containerRef} className='response-section-wrapper'>
      {statusCodes.length > 0 && (
        <div className='response-section-header flex-wrap gap-y-3'>
          <h2 className='response-section-title m-0!'>Response</h2>
          <div className='response-section-meta flex-wrap gap-y-3'>
            <ChipSelect
              modal={false}
              aria-label={`Response status code: ${selectedCode}`}
              value={selectedCode}
              onChange={handleSelectCode}
              options={statusCodes.map((code) => ({ label: code, value: code }))}
              align='end'
              dropdownWidth={96}
              contentClassName='min-w-0'
            />
          </div>
        </div>
      )}
      <div className='response-section-content'>{children}</div>
    </div>
  )
}
