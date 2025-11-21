'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Badge,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
} from '@/components/emcn'
import { getProviderIcon } from '@/providers/utils'
import { MODEL_OPTIONS } from '../../constants'

interface ModelSelectorProps {
  /** Currently selected model */
  selectedModel: string
  /** Whether the input is near the top of viewport (affects dropdown direction) */
  isNearTop: boolean
  /** Callback when model is selected */
  onModelSelect: (model: string) => void
}

/**
 * Gets the appropriate icon component for a model
 */
function getModelIconComponent(modelValue: string) {
  const IconComponent = getProviderIcon(modelValue)
  if (!IconComponent) {
    return null
  }
  return <IconComponent className='h-3.5 w-3.5' />
}

/**
 * Model selector dropdown for choosing AI model.
 * Displays model icon and label.
 *
 * @param props - Component props
 * @returns Rendered model selector dropdown
 */
export function ModelSelector({ selectedModel, isNearTop, onModelSelect }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const getCollapsedModeLabel = () => {
    const model = MODEL_OPTIONS.find((m) => m.value === selectedModel)
    return model ? model.label : 'claude-4.5-sonnet'
  }

  const getModelIcon = () => {
    const IconComponent = getProviderIcon(selectedModel)
    if (!IconComponent) {
      return null
    }
    return (
      <span className='flex-shrink-0'>
        <IconComponent className='h-3 w-3' />
      </span>
    )
  }

  const handleSelect = (modelValue: string) => {
    onModelSelect(modelValue)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: MouseEvent) => {
      // Keep popover open while resizing the panel (mousedown on resize handle)
      const target = event.target as Element | null
      if (
        target &&
        (target.closest('[aria-label="Resize panel"]') ||
          target.closest('[role="separator"]') ||
          target.closest('.cursor-ew-resize'))
      ) {
        return
      }

      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <Popover open={open} variant='default'>
      <PopoverAnchor asChild>
        <div ref={triggerRef} className='min-w-0 max-w-full'>
          <Badge
            variant='outline'
            className='min-w-0 max-w-full cursor-pointer rounded-[6px]'
            title='Choose model'
            aria-expanded={open}
            onMouseDown={(e) => {
              e.stopPropagation()
              setOpen((prev) => !prev)
            }}
          >
            {getModelIcon()}
            <span className='min-w-0 flex-1 truncate'>{getCollapsedModeLabel()}</span>
          </Badge>
        </div>
      </PopoverAnchor>
      <PopoverContent
        ref={popoverRef}
        side={isNearTop ? 'bottom' : 'top'}
        align='start'
        sideOffset={4}
        maxHeight={280}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <PopoverScrollArea className='space-y-[2px]'>
          {MODEL_OPTIONS.map((option) => (
            <PopoverItem
              key={option.value}
              active={selectedModel === option.value}
              onClick={() => handleSelect(option.value)}
            >
              {getModelIconComponent(option.value)}
              <span>{option.label}</span>
            </PopoverItem>
          ))}
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}
