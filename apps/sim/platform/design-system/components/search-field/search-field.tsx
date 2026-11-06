'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { IconButton } from '@/platform/design-system/components/button/button'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import styles from '@/platform/design-system/components/search-field/search-field.module.css'

interface SearchFieldProps {
  label: string
  placeholder?: string
  defaultValue?: string
  value?: string
  shortcut?: '⌘K' | '/'
  variant?: 'outlined' | 'sidebar' | 'quiet'
  onValueChange?: (query: string) => void
}

export function SearchField({
  label,
  placeholder,
  defaultValue = '',
  value,
  shortcut,
  variant = 'outlined',
  onValueChange,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  const queryEdges = useScrollEdges('horizontal', { viewport: input })
  const [draft, setDraft] = useState(defaultValue)
  const query = value ?? draft
  const adoptInitialInput = useEffectEvent(() => {
    const typed = input.current?.value
    if (typed !== undefined && typed !== query) change(typed)
  })
  useEffect(() => {
    adoptInitialInput()
  }, [])
  useEffect(() => {
    if (!shortcut) return
    function focus(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !input.current?.getClientRects().length
      )
        return
      const matches =
        shortcut === '⌘K'
          ? (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
          : event.key === '/' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !(
              event.target instanceof HTMLElement &&
              event.target.closest(
                'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
              )
            )
      if (!matches) return
      event.preventDefault()
      input.current?.focus()
    }
    document.addEventListener('keydown', focus)
    return () => document.removeEventListener('keydown', focus)
  }, [shortcut])

  function change(next: string) {
    if (value === undefined) setDraft(next)
    onValueChange?.(next)
  }
  return (
    <div className={styles.search} data-variant={variant}>
      <Icon name='I089' />
      <span className={styles.queryFrame}>
        <input
          ref={queryEdges}
          type='search'
          aria-label={label}
          placeholder={placeholder}
          className={styles.query}
          data-type='T043'
          value={query}
          onChange={(event) => change(event.currentTarget.value)}
        />
      </span>
      {query ? (
        <IconButton
          label='Clear search'
          icon='I105'
          size='compact'
          onClick={() => {
            change('')
            input.current?.focus()
          }}
        />
      ) : (
        shortcut && (
          <kbd className={styles.shortcut} data-type='T001'>
            {shortcut === '/' ? <Icon name='I044' /> : shortcut}
          </kbd>
        )
      )}
    </div>
  )
}
