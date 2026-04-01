'use client'

import { useCallback, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { Switch } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

/** Maximum character limits for form fields */
const MAX_LENGTHS = {
  FORM_TITLE: 80,
  FORM_DESCRIPTION: 250,
  FIELD_LABEL: 50,
  FIELD_DESCRIPTION: 200,
} as const

interface CharacterCounterProps {
  current: number
  max: number
  className?: string
}

/**
 * Displays a character count indicator (X/Max).
 */
function CharacterCounter({ current, max, className }: CharacterCounterProps) {
  const isNearLimit = current >= max * 0.9
  const isAtLimit = current >= max

  return (
    <span
      className={cn(
        'text-micro tabular-nums transition-colors',
        isAtLimit
          ? 'text-[var(--text-error)]'
          : isNearLimit
            ? 'text-[var(--text-warning)]'
            : 'text-[var(--text-muted)]',
        className
      )}
    >
      {current}/{max}
    </span>
  )
}

interface FieldConfig {
  name: string
  type: string
  label: string
  description?: string
  required?: boolean
}

interface FormBuilderProps {
  title: string
  onTitleChange: (title: string) => void
  description: string
  onDescriptionChange: (description: string) => void
  fieldConfigs: FieldConfig[]
  onFieldConfigsChange: (configs: FieldConfig[]) => void
  titleError?: string
}

/**
 * Interactive form builder preview component.
 * Displays an editable form preview with drag-and-drop reorderable fields.
 */
export function FormBuilder({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  fieldConfigs,
  onFieldConfigsChange,
  titleError,
}: FormBuilderProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const [focusedInput, setFocusedInput] = useState<string | null>(null)
  const dragImageRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))

    // Get the parent item element for the drag image
    const itemElement = itemRefs.current[index]
    if (!itemElement) return

    // Create a custom drag image with background
    const clone = itemElement.cloneNode(true) as HTMLDivElement
    clone.style.position = 'absolute'
    clone.style.top = '-9999px'
    clone.style.left = '-9999px'
    clone.style.width = `${itemElement.offsetWidth}px`
    clone.style.backgroundColor = 'var(--surface-1)'
    clone.style.borderRadius = '4px'
    clone.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)'
    clone.style.opacity = '0.95'
    clone.style.border = '1px solid var(--border-1)'
    document.body.appendChild(clone)
    dragImageRef.current = clone

    // Offset to align with the grip handle (10px padding + 6px grip padding)
    e.dataTransfer.setDragImage(clone, 16, itemElement.offsetHeight / 2)

    // Cleanup after drag starts
    requestAnimationFrame(() => {
      if (dragImageRef.current) {
        document.body.removeChild(dragImageRef.current)
        dragImageRef.current = null
      }
    })
  }, [])

  const handleDragEnd = useCallback(() => {
    // Perform the reorder if we have valid indices
    if (draggedIndex !== null && dropTargetIndex !== null && draggedIndex !== dropTargetIndex) {
      const newConfigs = [...fieldConfigs]
      const [draggedItem] = newConfigs.splice(draggedIndex, 1)
      // Adjust target index if dragging down
      const adjustedTarget = dropTargetIndex > draggedIndex ? dropTargetIndex - 1 : dropTargetIndex
      newConfigs.splice(adjustedTarget, 0, draggedItem)
      onFieldConfigsChange(newConfigs)
    }

    setDraggedIndex(null)
    setDropTargetIndex(null)

    if (dragImageRef.current) {
      document.body.removeChild(dragImageRef.current)
      dragImageRef.current = null
    }
  }, [draggedIndex, dropTargetIndex, fieldConfigs, onFieldConfigsChange])

  const handleContainerDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      if (draggedIndex === null) return

      const containerRect = containerRef.current?.getBoundingClientRect()
      if (!containerRect) return

      const y = e.clientY

      // Find the drop position based on cursor Y
      let newDropIndex = fieldConfigs.length
      for (let i = 0; i < itemRefs.current.length; i++) {
        const item = itemRefs.current[i]
        if (!item) continue

        const rect = item.getBoundingClientRect()
        const midpoint = rect.top + rect.height / 2

        if (y < midpoint) {
          newDropIndex = i
          break
        }
      }

      // Don't allow dropping at same position or adjacent (no change)
      if (newDropIndex !== dropTargetIndex) {
        setDropTargetIndex(newDropIndex)
      }
    },
    [draggedIndex, dropTargetIndex, fieldConfigs.length]
  )

  const handleContainerDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null
    if (!relatedTarget || !containerRef.current?.contains(relatedTarget)) {
      setDropTargetIndex(null)
    }
  }, [])

  const updateFieldConfig = useCallback(
    (index: number, updates: Partial<FieldConfig>) => {
      const newConfigs = fieldConfigs.map((config, i) =>
        i === index ? { ...config, ...updates } : config
      )
      onFieldConfigsChange(newConfigs)
    },
    [fieldConfigs, onFieldConfigsChange]
  )

  return (
    <div className='overflow-hidden rounded-sm border border-[var(--border-1)]'>
      {/* Header */}
      <div className='border-[var(--border-1)] border-b px-2.5 py-2'>
        <div className='flex items-center gap-1.5'>
          <input
            type='text'
            value={title}
            onChange={(e) => {
              if (e.target.value.length <= MAX_LENGTHS.FORM_TITLE) {
                onTitleChange(e.target.value)
              }
            }}
            onFocus={() => setFocusedInput('title')}
            onBlur={() => setFocusedInput(null)}
            placeholder='Form Title'
            maxLength={MAX_LENGTHS.FORM_TITLE}
            className={cn(
              'min-w-0 flex-1 bg-transparent font-medium text-[var(--text-primary)] text-sm outline-none',
              'placeholder:text-[var(--text-muted)]',
              titleError && 'text-[var(--text-error)]'
            )}
          />
          {focusedInput === 'title' && (
            <CharacterCounter current={title.length} max={MAX_LENGTHS.FORM_TITLE} />
          )}
        </div>
        {titleError && <p className='mt-1 text-[var(--text-error)] text-caption'>{titleError}</p>}
        <div className='mt-1 flex items-center gap-1.5'>
          <input
            type='text'
            value={description}
            onChange={(e) => {
              if (e.target.value.length <= MAX_LENGTHS.FORM_DESCRIPTION) {
                onDescriptionChange(e.target.value)
              }
            }}
            onFocus={() => setFocusedInput('description')}
            onBlur={() => setFocusedInput(null)}
            placeholder='Description'
            maxLength={MAX_LENGTHS.FORM_DESCRIPTION}
            className='min-w-0 flex-1 bg-transparent text-[var(--text-secondary)] text-caption outline-none placeholder:text-[var(--text-muted)]'
          />
          {focusedInput === 'description' && (
            <CharacterCounter current={description.length} max={MAX_LENGTHS.FORM_DESCRIPTION} />
          )}
        </div>
      </div>

      {/* Fields */}
      <div
        ref={containerRef}
        className='relative'
        onDragOver={handleContainerDragOver}
        onDragLeave={handleContainerDragLeave}
      >
        {fieldConfigs.map((config, index) => {
          const showIndicatorAbove =
            dropTargetIndex === index && draggedIndex !== null && draggedIndex !== index

          return (
            <div
              key={config.name}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              className={cn(
                'relative border-[var(--border-1)] border-b px-2.5 py-2 last:border-b-0',
                draggedIndex === index && 'opacity-40'
              )}
            >
              {/* Drop indicator line - shown above this item */}
              {showIndicatorAbove && (
                <div className='-translate-y-1/2 pointer-events-none absolute top-0 right-0 left-0 z-20 h-[2px] bg-[var(--brand-accent)]'>
                  <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-0 h-[6px] w-[6px] rounded-full bg-[var(--brand-accent)]' />
                  <div className='-translate-y-1/2 absolute top-1/2 right-0 h-[6px] w-[6px] translate-x-1/2 rounded-full bg-[var(--brand-accent)]' />
                </div>
              )}

              {/* Label row */}
              <div className='flex items-center gap-1.5'>
                {/* Grip handle - larger hit area with negative margins */}
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnd={handleDragEnd}
                  className='-my-1.5 -ml-1.5 flex cursor-grab items-center py-1.5 pl-1.5 text-[var(--text-muted)] hover-hover:text-[var(--text-tertiary)] active:cursor-grabbing'
                >
                  <GripVertical className='h-[12px] w-[12px]' />
                </div>
                <input
                  type='text'
                  value={config.label}
                  onChange={(e) => {
                    if (e.target.value.length <= MAX_LENGTHS.FIELD_LABEL) {
                      updateFieldConfig(index, { label: e.target.value })
                    }
                  }}
                  onFocus={() => setFocusedInput(`field-label-${index}`)}
                  onBlur={() => setFocusedInput(null)}
                  placeholder='Label'
                  maxLength={MAX_LENGTHS.FIELD_LABEL}
                  className='min-w-0 flex-1 bg-transparent font-medium text-[var(--text-primary)] text-small outline-none placeholder:text-[var(--text-muted)]'
                />
                {focusedInput === `field-label-${index}` && (
                  <CharacterCounter current={config.label.length} max={MAX_LENGTHS.FIELD_LABEL} />
                )}
                <div className='flex items-center gap-1.5'>
                  <span className='text-[var(--text-tertiary)] text-xs'>Required</span>
                  <Switch
                    checked={config.required ?? false}
                    onCheckedChange={(checked) => updateFieldConfig(index, { required: checked })}
                  />
                </div>
              </div>

              {/* Help text */}
              <div className='mt-1 flex items-center gap-1.5 pl-4.5'>
                <input
                  type='text'
                  value={config.description || ''}
                  onChange={(e) => {
                    if (e.target.value.length <= MAX_LENGTHS.FIELD_DESCRIPTION) {
                      updateFieldConfig(index, { description: e.target.value })
                    }
                  }}
                  onFocus={() => setFocusedInput(`field-desc-${index}`)}
                  onBlur={() => setFocusedInput(null)}
                  placeholder='Description...'
                  maxLength={MAX_LENGTHS.FIELD_DESCRIPTION}
                  className='min-w-0 flex-1 bg-transparent text-[var(--text-secondary)] text-xs outline-none placeholder:text-[var(--text-muted)]'
                />
                {focusedInput === `field-desc-${index}` && (
                  <CharacterCounter
                    current={(config.description || '').length}
                    max={MAX_LENGTHS.FIELD_DESCRIPTION}
                  />
                )}
              </div>

              {/* Field mapping */}
              <div className='mt-1.5 ml-4.5 flex items-center justify-between border-[var(--border-1)] border-t border-dashed pt-1.5'>
                <span className='text-[var(--text-muted)] text-micro'>
                  {config.name ? (
                    <>
                      maps to <code>{config.name}</code>
                    </>
                  ) : null}
                </span>
                <span className='text-[var(--text-muted)] text-micro'>{config.type}</span>
              </div>
            </div>
          )
        })}

        {/* Drop indicator at the end */}
        {dropTargetIndex === fieldConfigs.length && draggedIndex !== null && (
          <div className='pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-[2px] translate-y-1/2 bg-[var(--brand-accent)]'>
            <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-0 h-[6px] w-[6px] rounded-full bg-[var(--brand-accent)]' />
            <div className='-translate-y-1/2 absolute top-1/2 right-0 h-[6px] w-[6px] translate-x-1/2 rounded-full bg-[var(--brand-accent)]' />
          </div>
        )}
      </div>
    </div>
  )
}
