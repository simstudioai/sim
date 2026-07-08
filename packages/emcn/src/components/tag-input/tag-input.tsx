/**
 * A tag input component for managing a list of tags with validation support.
 *
 * @example
 * ```tsx
 * import { TagInput, type TagItem } from '../../index'
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
 *
 * @example With file input enabled
 * ```tsx
 * <TagInput
 *   items={items}
 *   onAdd={handleAdd}
 *   onRemove={handleRemove}
 *   fileInputOptions={{
 *     enabled: true,
 *     accept: '.csv,.txt',
 *     extractValues: (text) => text.match(/[\w.-]+@[\w.-]+\.\w+/g) || [],
 *   }}
 * />
 * ```
 */
'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Paperclip, Plus, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { handleKeyboardActivation } from '../../lib/keyboard'
import { ChipTag, chipTagVariants } from '../chip-tag/chip-tag'
import { Tooltip } from '../tooltip/tooltip'

/**
 * Variant styles for the TagInput container.
 *
 * @remarks
 * - `default` matches the standard Input component styling for consistent height.
 * - `block` matches the multi-row "Description" textarea pattern: larger radius,
 *   top-aligned items, taller min-height, and no focus ring — for use inside
 *   form sections where the tag input visually pairs with textarea fields.
 *   Uses `content-start` so wrapped flex lines pack tightly at `h-5` (20px) row
 *   pitch instead of being stretched by the `min-h-[112px]` floor; unused
 *   vertical space stays at the bottom of the container, and content beyond
 *   `max-h` scrolls vertically.
 */
const tagInputVariants = cva(
  'flex w-full cursor-text flex-wrap gap-2 overflow-y-auto border border-[var(--border-1)] bg-[var(--surface-5)] px-2 transition-colors',
  {
    variants: {
      variant: {
        default:
          'items-center rounded-sm py-1.5 focus-within:outline-none focus-within:ring-1 focus-within:ring-[var(--brand-accent)] dark:bg-[var(--surface-5)]',
        block:
          'min-h-[112px] content-start items-start rounded-lg py-2 focus-within:outline-none dark:bg-[var(--surface-4)]',
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
  /**
   * Why the item is invalid. Shown in a tooltip on the invalid chip (and as
   * screen-reader-only text inside it). Ignored when `isValid` is true.
   */
  error?: string
}

/**
 * Options for enabling file input functionality.
 */
export interface FileInputOptions {
  /** Whether file input is enabled */
  enabled: boolean
  /** Accepted file types (default: '.csv,.txt,text/csv,text/plain') */
  accept?: string
  /** Icon component to render (default: Paperclip) */
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>
  /** Extract values from file content. Each extracted value will be passed to onAdd. */
  extractValues?: (text: string) => string[]
  /** Tooltip text for the file input button */
  tooltip?: string
}

/**
 * Props for the TagInput component.
 */
interface TagInputProps extends VariantProps<typeof tagInputVariants> {
  /** Array of tag items with value and validity status */
  items: TagItem[]
  /**
   * Callback when a new tag is added.
   * Return true if the value was valid and added, false if invalid.
   */
  onAdd: (value: string) => boolean
  /** Callback when a tag is removed (receives value, index, and isValid) */
  onRemove: (value: string, index: number, isValid: boolean) => void
  /** Callback when the input value changes (useful for clearing errors) */
  onInputChange?: (value: string) => void
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
  /**
   * Maximum height for the container. Defaults to `max-h-48` (192px) for the
   * `block` variant, `max-h-32` (128px) otherwise.
   */
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
  /** Options for enabling file input (drag/drop and file picker) */
  fileInputOptions?: FileInputOptions
}

interface TagInputTagProps {
  item: TagItem
  index: number
  onRemove: TagInputProps['onRemove']
  disabled: boolean
  suffix?: React.ReactNode
}

const TagInputTag = React.memo(function TagInputTag({
  item,
  index,
  onRemove,
  disabled,
  suffix,
}: TagInputTagProps) {
  const handleRemove = React.useCallback(() => {
    onRemove(item.value, index, item.isValid)
  }, [item.value, item.isValid, index, onRemove])

  const showError = !item.isValid && !!item.error

  const tag = (
    <ChipTag
      variant='invite'
      invalid={!item.isValid}
      className='min-w-0 max-w-full bg-[var(--surface-6)] shadow-none dark:bg-[var(--surface-3)]'
      rightIcon={disabled ? undefined : X}
      onRightIconClick={disabled ? undefined : handleRemove}
      rightIconLabel={`Remove ${item.value}`}
    >
      <span className='min-w-0 flex-1 translate-y-[0.5px] truncate font-medium font-sans text-sm leading-5'>
        {item.value}
      </span>
      {showError && <span className='sr-only'>{item.error}</span>}
      {suffix}
    </ChipTag>
  )

  if (!showError) return tag

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{tag}</Tooltip.Trigger>
      <Tooltip.Content>{item.error}</Tooltip.Content>
    </Tooltip.Root>
  )
})

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
      onInputChange,
      placeholder = 'Enter values',
      placeholderWithTags = 'Add another',
      disabled = false,
      className,
      inputClassName,
      maxHeight,
      id,
      name,
      autoFocus = false,
      triggerKeys = ['Enter', ',', ' '],
      renderTagSuffix,
      fileInputOptions,
      variant,
    },
    ref
  ) => {
    const effectiveMaxHeight = maxHeight ?? (variant === 'block' ? 'max-h-48' : 'max-h-32')
    const [inputValue, setInputValue] = React.useState('')
    const [isDragging, setIsDragging] = React.useState(false)
    const internalRef = React.useRef<HTMLInputElement>(null)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const inputRef = (ref as React.RefObject<HTMLInputElement>) || internalRef

    const hasItems = items.length > 0
    const fileInputEnabled = fileInputOptions?.enabled ?? false
    const FileIcon = fileInputOptions?.icon ?? Paperclip
    const fileAccept = fileInputOptions?.accept ?? '.csv,.txt,text/csv,text/plain'

    React.useEffect(() => {
      if (autoFocus && inputRef.current) {
        inputRef.current.focus()
      }
    }, [autoFocus, inputRef])

    const handleFileContent = React.useCallback(
      async (file: File) => {
        try {
          const text = await file.text()
          const extractValues = fileInputOptions?.extractValues
          if (extractValues) {
            const values = extractValues(text)
            values.forEach((value) => onAdd(value))
          }
        } catch {}
      },
      [fileInputOptions?.extractValues, onAdd]
    )

    const handleDragOver = React.useCallback(
      (e: React.DragEvent) => {
        if (!fileInputEnabled) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setIsDragging(true)
      },
      [fileInputEnabled]
    )

    const handleDragLeave = React.useCallback(
      (e: React.DragEvent) => {
        if (!fileInputEnabled) return
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
      },
      [fileInputEnabled]
    )

    const handleDrop = React.useCallback(
      async (e: React.DragEvent) => {
        if (!fileInputEnabled) return
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        const files = Array.from(e.dataTransfer.files)
        const acceptPatterns = fileAccept.split(',').map((p) => p.trim().toLowerCase())

        const validFiles = files.filter((f) => {
          const ext = `.${f.name.split('.').pop()?.toLowerCase()}`
          const type = f.type.toLowerCase()
          return acceptPatterns.some((pattern) => pattern === ext || pattern === type)
        })

        for (const file of validFiles) {
          await handleFileContent(file)
        }
      },
      [fileInputEnabled, fileAccept, handleFileContent]
    )

    const handleFileInputChange = React.useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files) return

        for (const file of Array.from(files)) {
          await handleFileContent(file)
        }

        e.target.value = ''
      },
      [handleFileContent]
    )

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

    /**
     * Pasted values are committed through `onAdd` exactly like typing + Enter:
     * consumers render rejected values as flagged invalid chips, so nothing is
     * re-staged into the input afterwards — doing so would display the same
     * value twice (the invalid chip plus the raw text in the typing buffer).
     */
    const handlePaste = React.useCallback(
      (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault()
        const pastedText = e.clipboardData.getData('text')
        const pastedValues = pastedText.split(/[\s,;]+/).filter(Boolean)
        pastedValues.forEach((value) => {
          onAdd(value.trim())
        })
      },
      [onAdd]
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
        role='group'
        aria-label='Tag input'
        className={cn(
          tagInputVariants({ variant }),
          effectiveMaxHeight,
          'relative',
          fileInputEnabled && 'pr-7',
          isDragging && 'border-[var(--border)] border-dashed bg-[var(--surface-5)]',
          className
        )}
        onClick={handleContainerClick}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          handleKeyboardActivation(event, handleContainerClick)
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {fileInputEnabled && (
          <input
            ref={fileInputRef}
            type='file'
            accept={fileAccept}
            onChange={handleFileInputChange}
            className='hidden'
          />
        )}
        {isDragging && (
          <div className='absolute inset-0 flex items-center justify-center rounded-sm bg-[color-mix(in_srgb,var(--surface-5)_90%,transparent)]'>
            <span className='text-[var(--text-tertiary)] text-small'>Drop file here</span>
          </div>
        )}
        {items.map((item, index) => (
          <TagInputTag
            key={`item-${index}`}
            item={item}
            index={index}
            onRemove={onRemove}
            disabled={disabled}
            suffix={item.isValid ? renderTagSuffix?.(item.value, index) : undefined}
          />
        ))}
        <div
          className={cn(
            'flex h-5 min-w-0 max-w-full items-center',
            inputValue.trim() &&
              cn(
                chipTagVariants({ variant: 'invite' }),
                'min-w-0 max-w-full bg-[var(--surface-6)] shadow-none dark:bg-[var(--surface-3)]'
              )
          )}
        >
          <div className='relative inline-flex h-5 min-w-0 max-w-full items-center overflow-hidden'>
            {inputValue.trim() && (
              <span
                className='invisible whitespace-pre font-medium font-sans text-sm leading-5'
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
              onChange={(e) => {
                setInputValue(e.target.value)
                onInputChange?.(e.target.value)
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={handleBlur}
              placeholder={hasItems ? placeholderWithTags : placeholder}
              size={hasItems ? placeholderWithTags?.length || 10 : placeholder?.length || 12}
              className={cn(
                'appearance-none border-none bg-transparent align-middle font-sans outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50',
                inputValue.trim()
                  ? 'absolute top-0 left-0 h-full w-full p-0 font-medium text-inherit text-sm leading-5'
                  : 'h-5 w-auto min-w-0 p-0 font-medium text-[var(--text-body)] text-sm leading-5',
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
              className='relative flex flex-shrink-0 items-center opacity-80 transition-opacity before:absolute before:inset-[-10px] before:content-[""] hover-hover:opacity-100 focus:outline-none'
              disabled={disabled}
              aria-label='Add tag'
            >
              <Plus className='size-[14px]' />
            </button>
          )}
        </div>
        {fileInputEnabled && !disabled && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  fileInputRef.current?.click()
                }}
                className='-m-1.5 absolute right-2 bottom-[9px] p-1.5 text-[var(--text-tertiary)] transition-colors hover-hover:text-[var(--text-secondary)]'
                aria-label={fileInputOptions?.tooltip ?? 'Upload file'}
              >
                <FileIcon className='size-3.5' strokeWidth={2} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              {fileInputOptions?.tooltip ?? 'Upload file'}
            </Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>
    )
  }
)

TagInput.displayName = 'TagInput'

export { TagInput, tagInputVariants }
