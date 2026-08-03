'use client'

import * as React from 'react'
import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { TagInput, type TagItem } from '../tag-input/tag-input'

const ENTER_PREFIX = 'enter'

/**
 * Derives the post-first-chip placeholder from the initial placeholder so
 * consumers don't have to spell both. Tries an `'Enter <noun>s'` →
 * `'Add <noun>'` singularize; falls back to a generic `'Add another'`.
 *
 * Deliberately string ops rather than a regex — `/^Enter\s+(.+?)s?$/` has
 * polynomial backtracking on whitespace-heavy input (CodeQL js/redos).
 */
function derivePlaceholderWithTags(placeholder: string): string {
  const rest = placeholder.slice(ENTER_PREFIX.length)
  const noun = rest.trim()
  const startsWithEnter = placeholder.slice(0, ENTER_PREFIX.length).toLowerCase() === ENTER_PREFIX
  if (!startsWithEnter || rest === noun || !noun) return 'Add another'
  const singular = noun.toLowerCase().endsWith('s') ? noun.slice(0, -1) : noun
  return `Add ${singular}`
}

export interface ChipEmailsInputProps {
  /** Current list of accepted entries. */
  value: string[]
  /** Called with the next list when valid items are added or removed. */
  onChange: (next: string[]) => void
  /**
   * Optional domain-level validator. Runs AFTER the internal format check
   * passes. Return an error message to reject the entry (added as an invalid
   * chip whose reason shows in a tooltip on hover); return `null` to accept.
   */
  validate?: (email: string) => string | null
  /**
   * Also accept a bare `@domain.tld` entry alongside full addresses, for
   * allowlists that grant access to an entire domain.
   * @default false
   */
  allowDomains?: boolean
  /** Placeholder shown when no chips exist. Defaults to `'Enter emails'`. */
  placeholder?: string
  /**
   * Placeholder shown once at least one chip exists. Defaults to a singularized
   * form of {@link ChipEmailsInputProps.placeholder}; pass this when that
   * derivation reads awkwardly.
   */
  placeholderWithTags?: string
  /**
   * Chip surface. `'block'` is the taller multi-row form variant.
   * @default 'block'
   */
  variant?: 'default' | 'block'
  /** Disables the input and hides the per-chip remove buttons. */
  disabled?: boolean
  /** Focus the input when the component mounts. */
  autoFocus?: boolean
  /** HTML `id` for the inner input, for label association. */
  id?: string
}

/**
 * Canonical multi-email chip input. Owns the chip lifecycle (valid + invalid
 * items, dedupe, lowercase normalization, format validation, paste, Backspace,
 * per-chip error tooltips) and lifts only the accepted list up via `onChange`.
 * Each rejected entry carries its rejection reason on the chip itself.
 *
 * Inside a `ChipModal`, prefer `ChipModalField type='emails'`, which wraps this
 * with the canonical label/hint/error row. Use this component directly only in
 * surfaces that own their own field chrome.
 */
export function ChipEmailsInput({
  value,
  onChange,
  validate,
  allowDomains = false,
  placeholder = 'Enter emails',
  placeholderWithTags,
  variant = 'block',
  disabled,
  autoFocus,
  id,
}: ChipEmailsInputProps) {
  const [items, setItems] = React.useState<TagItem[]>(() =>
    value.map((v) => ({ value: v, isValid: true }))
  )

  /**
   * Synchronous mirror of `items`. Pasting multiple values calls `handleAdd`
   * once per value within a single event, before React re-renders — reading
   * the `items` state there would make every call see the same stale array
   * and each add overwrite the previous one (only the last pasted email
   * survives). All reads and writes go through the ref so consecutive adds
   * compose; `commitItems` keeps state and ref in lockstep.
   */
  const itemsRef = React.useRef<TagItem[]>(items)

  const commitItems = React.useCallback((next: TagItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  /**
   * Reconcile internal `items` with the consumer's `value` when the latter
   * changes externally (programmatic clear, partial-failure reseed, etc.).
   * When our own `onChange` is the source of the update, the valid items in
   * `items` already match `value` and this is a no-op.
   */
  React.useEffect(() => {
    const prevValid = itemsRef.current.filter((item) => item.isValid).map((item) => item.value)
    if (prevValid.length === value.length && prevValid.every((v, idx) => v === value[idx])) {
      return
    }
    itemsRef.current = value.map((v) => ({ value: v, isValid: true }))
    setItems(itemsRef.current)
  }, [value])

  const handleAdd = React.useCallback(
    (raw: string): boolean => {
      const email = normalizeEmail(raw)
      if (!email) return false
      const current = itemsRef.current
      if (current.some((item) => item.value === email)) return false

      if (!isValidEmailSyntax(email, allowDomains)) {
        commitItems([
          ...current,
          {
            value: email,
            isValid: false,
            error: allowDomains ? 'Invalid email or domain' : 'Invalid email format',
          },
        ])
        return false
      }

      const reason = validate?.(email)
      if (reason) {
        commitItems([...current, { value: email, isValid: false, error: reason }])
        return false
      }

      const next = [...current, { value: email, isValid: true }]
      commitItems(next)
      onChange(next.filter((item) => item.isValid).map((item) => item.value))
      return true
    },
    [validate, onChange, commitItems, allowDomains]
  )

  const handleRemove = React.useCallback(
    (_removed: string, index: number) => {
      const current = itemsRef.current
      const wasValid = current[index]?.isValid ?? false
      const next = current.filter((_, i) => i !== index)
      commitItems(next)
      if (wasValid) {
        onChange(next.filter((item) => item.isValid).map((item) => item.value))
      }
    },
    [onChange, commitItems]
  )

  return (
    <TagInput
      variant={variant}
      items={items}
      onAdd={handleAdd}
      onRemove={handleRemove}
      placeholder={placeholder}
      placeholderWithTags={placeholderWithTags ?? derivePlaceholderWithTags(placeholder)}
      disabled={disabled}
      autoFocus={autoFocus}
      id={id}
    />
  )
}

ChipEmailsInput.displayName = 'ChipEmailsInput'
