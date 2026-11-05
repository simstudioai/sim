import type { Ref } from 'react'
import styles from '@/platform/design-system/components/composer-input/composer-input.module.css'

interface ComposerInputProps {
  inputRef?: Ref<HTMLTextAreaElement>
  value?: string
  onValueChange?: (text: string) => void
  onSubmit?: () => void
  onPasteFiles?: (items: File[]) => void
  onPasteText?: (text: string) => void
  label: string
  placeholder?: string
  defaultValue?: string
  density?: 'standard' | 'compact'
}

export function ComposerInput({
  label,
  inputRef,
  value,
  onValueChange,
  onSubmit,
  onPasteFiles,
  onPasteText,
  placeholder,
  defaultValue,
  density = 'standard',
}: ComposerInputProps) {
  return (
    <textarea
      ref={inputRef}
      value={value}
      onChange={onValueChange && ((e) => onValueChange(e.currentTarget.value))}
      onKeyDown={
        onSubmit &&
        ((e) => {
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            !window.matchMedia('(width < 48rem) and (pointer: coarse)').matches
          ) {
            e.preventDefault()
            onSubmit()
          }
        })
      }
      onPaste={
        (onPasteFiles || onPasteText) &&
        ((e) => {
          const files = Array.from(e.clipboardData.files)
          if (files.length && onPasteFiles) {
            e.preventDefault()
            onPasteFiles(files)
            return
          }
          const text = e.clipboardData.getData('text/plain')
          if (text.length > 2000 && onPasteText) {
            e.preventDefault()
            onPasteText(text)
          }
        })
      }
      aria-label={label}
      className={styles.composerInput}
      data-density={density}
      data-type='T048'
      data-type-light={density === 'compact' ? 'T094' : undefined}
      rows={1}
      placeholder={placeholder}
      defaultValue={defaultValue}
    />
  )
}
