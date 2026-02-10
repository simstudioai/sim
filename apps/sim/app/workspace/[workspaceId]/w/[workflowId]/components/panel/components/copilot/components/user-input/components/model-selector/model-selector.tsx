'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
} from '@/components/emcn'
import {
  AnthropicIcon,
  AzureIcon,
  BedrockIcon,
  GeminiIcon,
  OpenAIIcon,
} from '@/components/icons'
import { useCopilotStore } from '@/stores/panel'

interface ModelSelectorProps {
  /** Currently selected model */
  selectedModel: string
  /** Whether the input is near the top of viewport (affects dropdown direction) */
  isNearTop: boolean
  /** Callback when model is selected */
  onModelSelect: (model: string) => void
}

/**
 * Map a provider string (from the available-models API) to its icon component.
 * Falls back to null when the provider is unrecognised.
 */
const PROVIDER_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  gemini: GeminiIcon,
  google: GeminiIcon,
  bedrock: BedrockIcon,
  azure: AzureIcon,
  'azure-openai': AzureIcon,
  'azure-anthropic': AzureIcon,
}

function getIconForProvider(provider: string): React.ComponentType<{ className?: string }> | null {
  return PROVIDER_ICON_MAP[provider] ?? null
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
  const availableModels = useCopilotStore((state) => state.availableModels)

  const modelOptions = useMemo(() => {
    return availableModels.map((model) => ({
      value: model.id,
      label: model.friendlyName || model.id,
      provider: model.provider,
    }))
  }, [availableModels])

  /** Look up the provider for a model id from the available-models list */
  const getProviderForModel = (modelId: string): string | undefined => {
    return availableModels.find((m) => m.id === modelId)?.provider
  }

  const getCollapsedModeLabel = () => {
    const model = modelOptions.find((m) => m.value === selectedModel)
    return model?.label || selectedModel || 'No models available'
  }

  const getModelIcon = () => {
    const provider = getProviderForModel(selectedModel)
    if (!provider) return null
    const IconComponent = getIconForProvider(provider)
    if (!IconComponent) return null
    return (
      <span className='flex-shrink-0'>
        <IconComponent className='h-3 w-3' />
      </span>
    )
  }

  const getModelIconComponent = (modelValue: string) => {
    const provider = getProviderForModel(modelValue)
    if (!provider) return null
    const IconComponent = getIconForProvider(provider)
    if (!IconComponent) return null
    return <IconComponent className='h-3.5 w-3.5' />
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
          {modelOptions.length > 0 ? (
            modelOptions.map((option) => (
              <PopoverItem
                key={option.value}
                active={selectedModel === option.value}
                onClick={() => handleSelect(option.value)}
              >
                {getModelIconComponent(option.value)}
                <span>{option.label}</span>
              </PopoverItem>
            ))
          ) : (
            <div className='px-2 py-2 text-xs text-[var(--text-muted)]'>No models available</div>
          )}
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}
