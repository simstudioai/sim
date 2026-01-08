/**
 * A tag input component for managing a list of tags with validation support.
 *
 * @example
 * ```tsx
 * import { TagInput, type TagItem } from '@/components/emcn'
 *
 * const [items, setItems] = useState<TagItem[]>([])
 *
 * <TagInput
 *   items={items}
 *   onAdd={(value) => {
 *     const isValid = isValidEmail(value)
 *     setItems(prev => [...prev, { value, isValid }])
 *     return isValid
 *   }}
 *   onRemove={(value, index) => {
 *     setItems(prev => prev.filter((_, i) => i !== index))
 *   }}
 *   placeholder="Enter emails"
 * />
 * ```
 */
'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'

/**
 * Variant styles for the Tag component.
 * No vertical padding to fit within the input's natural line height without causing expansion.
 * Uses colored badge-style variants (blue for valid, red for invalid).
 */
const tagVariants = cva(
  'flex w-auto cursor-default items-center gap-[3px] rounded-[4px] px-[4px] font-medium font-sans text-[13px] leading-[20px] transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[#bfdbfe] text-[#1d4ed8] dark:bg-[rgba(59,130,246,0.2)] dark:text-[#93c5fd]',
        invalid:
          'bg-[#fecaca] text-[var(--text-error)] dark:bg-[#551a1a] dark:text-[var(--text-error)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

/**
 * Props for the Tag component.
 */
export interface TagProps extends VariantProps<typeof tagVariants> {
  /** The tag value to display */
  value: string
  /** Callback when remove button is clicked */
  onRemove?: () => void
  /** Whether the tag is disabled */
  disabled?: boolean
  /** Additional class names */
  className?: string
  /** Optional suffix content (e.g., "sent" label) */
  suffix?: React.ReactNode
}

/**
 * A single tag badge with optional remove button.
 */
const Tag = React.memo(function Tag({
  value,
  onRemove,
  disabled,
  variant,
  className,
  suffix,
}: TagProps) {
  return (
    <div className={cn(tagVariants({ variant }), className)}>
      <span className='max-w-[200px] truncate'>{value}</span>
      {suffix}
      {!disabled && onRemove && (
        <button
          type='button'
          onClick={onRemove}
          className={cn(
            'flex-shrink-0 opacity-80 transition-opacity hover:opacity-100 focus:outline-none',
            variant === 'invalid'
              ? 'text-[var(--text-error)]'
              : 'text-[#1d4ed8] dark:text-[#93c5fd]'
          )}
          aria-label={`Remove ${value}`}
        >
          <X className='h-[12px] w-[12px] translate-y-[0.5px]' />
        </button>
      )}
    </div>
  )
})

/**
 * Variant styles for the TagInput container.
 * Matches the Input component styling exactly for consistent height.
 */
const tagInputVariants = cva(
  'scrollbar-hide flex w-full cursor-text flex-wrap items-center gap-x-[8px] gap-y-[4px] overflow-y-auto rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] py-[6px] transition-colors focus-within:outline-none dark:bg-[var(--surface-5)]',
  {
    variants: {
      variant: {
        default: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

/**
 * Represents a tag item with its value and validity status.
 */
export interface TagItem {
  value: string
  isValid: boolean
}

/**
 * Props for the TagInput component.
 */
export interface TagInputProps extends VariantProps<typeof tagInputVariants> {
  /** Array of tag items with value and validity status */
  items: TagItem[]
  /**
   * Callback when a new tag is added.
   * Return true if the value was valid and added, false if invalid.
   */
  onAdd: (value: string) => boolean
  /** Callback when a tag is removed (receives value, index, and isValid) */
  onRemove: (value: string, index: number, isValid: boolean) => void
  /** Placeholder text for the input */
  placeholder?: string
  /** Placeholder text when there are existing tags */
  placeholderWithTags?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Additional class names for the container */
  className?: string
  /** Additional class names for the input */
  inputClassName?: string
  /** Maximum height for the container (defaults to 128px / max-h-32) */
  maxHeight?: string
  /** HTML id for the input element */
  id?: string
  /** HTML name for the input element */
  name?: string
  /** Whether to auto-focus the input */
  autoFocus?: boolean
  /** Custom keys that trigger tag addition (defaults to Enter, comma, space) */
  triggerKeys?: string[]
  /** Optional render function for tag suffix content */
  renderTagSuffix?: (value: string, index: number) => React.ReactNode
}

/**
 * An input component for managing a list of tags.
 *
 * @remarks
 * - Maintains consistent height with standard Input component
 * - Supports keyboard navigation (Enter/comma/space to add, Backspace to remove)
 * - Handles paste with multiple values separated by whitespace, commas, or semicolons
 * - Displays invalid values with error styling
 */
const TagInput = React.forwardRef<HTMLInputElement, TagInputProps>(
  (
    {
      items,
      onAdd,
      onRemove,
      placeholder = 'Enter values',
      placeholderWithTags = 'Add another',
      disabled = false,
      className,
      inputClassName,
      maxHeight = 'max-h-32',
      id,
      name,
      autoFocus = false,
      triggerKeys = ['Enter', ',', ' '],
      renderTagSuffix,
      variant,
    },
    ref
  ) => {
    const [inputValue, setInputValue] = React.useState('')
    const internalRef = React.useRef<HTMLInputElement>(null)
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || internalRef

    const hasItems = items.length > 0

    React.useEffect(() => {
      if (autoFocus && inputRef.current) {
        inputRef.current.focus()
      }
    }, [autoFocus, inputRef])

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (triggerKeys.includes(e.key) && inputValue.trim()) {
          e.preventDefault()
          onAdd(inputValue.trim())
          setInputValue('')
        }

        if (e.key === 'Backspace' && !inputValue && items.length > 0) {
          const lastItem = items[items.length - 1]
          onRemove(lastItem.value, items.length - 1, lastItem.isValid)
        }
      },
      [inputValue, triggerKeys, onAdd, items, onRemove]
    )

    const handlePaste = React.useCallback(
      (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault()
        const pastedText = e.clipboardData.getData('text')
        const pastedValues = pastedText.split(/[\s,;]+/).filter(Boolean)

        let addedCount = 0
        pastedValues.forEach((value) => {
          if (onAdd(value.trim())) {
            addedCount++
          }
        })

        if (addedCount === 0 && pastedValues.length === 1) {
          setInputValue(inputValue + pastedValues[0])
        }
      },
      [onAdd, inputValue]
    )

    const handleBlur = React.useCallback(() => {
      if (inputValue.trim()) {
        onAdd(inputValue.trim())
        setInputValue('')
      }
    }, [inputValue, onAdd])

    const handleContainerClick = React.useCallback(() => {
      inputRef.current?.focus()
    }, [inputRef])

    return (
      <div
        className={cn(tagInputVariants({ variant }), maxHeight, className)}
        onClick={handleContainerClick}
      >
        {items.map((item, index) => (
          <Tag
            key={`item-${index}`}
            value={item.value}
            variant={item.isValid ? 'default' : 'invalid'}
            onRemove={() => onRemove(item.value, index, item.isValid)}
            disabled={disabled}
            suffix={item.isValid ? renderTagSuffix?.(item.value, index) : undefined}
          />
        ))}
        <div
          className={cn(
            'flex items-center',
            inputValue.trim() &&
              cn(tagVariants({ variant: 'default' }), 'gap-0 py-0 pr-0 pl-[4px] opacity-80')
          )}
        >
          <div className='relative inline-flex'>
            {inputValue.trim() && (
              <span
                className='invisible whitespace-pre font-medium font-sans text-[13px] leading-[20px]'
                aria-hidden='true'
              >
                {inputValue}
              </span>
            )}
            <input
              ref={inputRef}
              id={id}
              name={name}
              type='text'
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={handleBlur}
              placeholder={hasItems ? placeholderWithTags : placeholder}
              size={hasItems ? placeholderWithTags?.length || 10 : placeholder?.length || 12}
              className={cn(
                'border-none bg-transparent font-medium font-sans outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50',
                inputValue.trim()
                  ? 'absolute top-0 left-0 h-full w-full p-0 text-[13px] text-inherit leading-[20px]'
                  : 'w-auto min-w-0 p-0 text-foreground text-sm',
                inputClassName
              )}
              disabled={disabled}
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck={false}
              data-lpignore='true'
              data-form-type='other'
              aria-autocomplete='none'
            />
          </div>
          {inputValue.trim() && (
            <button
              type='button'
              onMouseDown={(e) => {
                e.preventDefault()
                if (inputValue.trim()) {
                  onAdd(inputValue.trim())
                  setInputValue('')
                  inputRef.current?.focus()
                }
              }}
              className='flex items-center px-[3px] opacity-80 transition-opacity hover:opacity-100 focus:outline-none'
              disabled={disabled}
              aria-label='Add tag'
            >
              <Plus className='h-[12px] w-[12px]' />
            </button>
          )}
        </div>
      </div>
    )
  }
)

TagInput.displayName = 'TagInput'

export { Tag, TagInput, tagInputVariants, tagVariants }
