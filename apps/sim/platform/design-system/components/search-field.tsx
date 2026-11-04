'use client'

import { useEffect, useRef, useState } from 'react'
import styles from '@/platform/design-system/components/choices.module.css'
import { IconButton } from '@/platform/design-system/components/controls'
import { Icon } from '@/platform/design-system/components/icon'

interface SearchFieldProps {
  label: string
  placeholder?: string
  defaultValue?: string
  shortcut?: '⌘K' | '/'
  variant?: 'outlined' | 'menu'
  onValueChange?: (query: string) => void
}

export function SearchField({
  label,
  placeholder,
  defaultValue = '',
  shortcut,
  variant = 'outlined',
  onValueChange,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(defaultValue)
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

  function change(value: string) {
    setQuery(value)
    onValueChange?.(value)
  }
  return (
    <div className={styles.search} data-variant={variant}>
      <Icon name='I089' />
      <input
        ref={input}
        type='search'
        aria-label={label}
        placeholder={placeholder}
        className={styles.query}
        data-type={variant === 'menu' ? 'T060' : 'T043'}
        value={query}
        onChange={(event) => change(event.currentTarget.value)}
      />
      {variant === 'outlined' &&
        (query ? (
          <IconButton
            label='Clear search'
            icon='I105'
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
        ))}
    </div>
  )
}
