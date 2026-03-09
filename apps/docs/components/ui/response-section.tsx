'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ResponseSectionProps {
  children: React.ReactNode
}

export function ResponseSection({ children }: ResponseSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [statusCodes, setStatusCodes] = useState<string[]>([])
  const [selectedCode, setSelectedCode] = useState<string>('')
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  /**
   * Detect when the fumadocs accordion children mount via MutationObserver,
   * then extract status codes and show the first one.
   * Replaces the previous approach that used `children` as a dependency
   * (which triggered on every render since children is a new object each time).
   */
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
      if (initialize()) {
        observer.disconnect()
      }
    })
    observer.observe(container, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelectCode(code: string) {
    setSelectedCode(code)
    setIsOpen(false)
    showStatusCode(code)
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className='response-section-wrapper'>
      {statusCodes.length > 0 && (
        <div className='response-section-header'>
          <h2 className='response-section-title'>Response</h2>
          <div className='response-section-meta'>
            <div ref={dropdownRef} className='response-section-dropdown-wrapper'>
              <button
                type='button'
                className='response-section-dropdown-trigger'
                onClick={() => setIsOpen(!isOpen)}
              >
                <span>{selectedCode}</span>
                <ChevronDown
                  className={cn(
                    'response-section-chevron',
                    isOpen && 'response-section-chevron-open'
                  )}
                />
              </button>
              {isOpen && (
                <div className='response-section-dropdown-menu'>
                  {statusCodes.map((code) => (
                    <button
                      key={code}
                      type='button'
                      className={cn(
                        'response-section-dropdown-item',
                        code === selectedCode && 'response-section-dropdown-item-selected'
                      )}
                      onClick={() => handleSelectCode(code)}
                    >
                      <span>{code}</span>
                      {code === selectedCode && (
                        <svg
                          className='response-section-check'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          strokeWidth='2'
                        >
                          <polyline points='20 6 9 17 4 12' />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className='response-section-content-type'>application/json</span>
          </div>
        </div>
      )}
      <div className='response-section-content'>{children}</div>
    </div>
  )
}
