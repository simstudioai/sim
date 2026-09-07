import type { Ref } from 'react'

interface ToolbarInputProps {
  label: string
  placeholder: string
  inputMode?: 'text' | 'url'
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  inputRef: Ref<HTMLInputElement>
  readOnly?: boolean
  invalid?: boolean
}

/** Flush toolbar field; ChipInput's standalone field chrome would break the shared floating bar. */
export function ToolbarInput({
  label,
  placeholder,
  inputMode = 'text',
  value,
  onChange,
  onCommit,
  onCancel,
  inputRef,
  readOnly = false,
  invalid = false,
}: ToolbarInputProps) {
  return (
    <input
      ref={inputRef}
      aria-label={label}
      aria-invalid={invalid || undefined}
      type='text'
      inputMode={inputMode}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          event.stopPropagation()
          return
        }
        if (event.key === 'Enter' && !readOnly) {
          event.preventDefault()
          onCommit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
      placeholder={placeholder}
      className='h-10 w-[220px] bg-transparent px-2 text-[var(--text-body)] text-small outline-hidden placeholder:text-[var(--text-subtle)] sm:h-[28px]'
    />
  )
}
