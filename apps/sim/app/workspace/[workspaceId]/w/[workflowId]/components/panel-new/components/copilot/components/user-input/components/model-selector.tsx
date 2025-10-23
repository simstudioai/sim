'use client'

import { Badge } from '@/components/emcn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TooltipProvider,
} from '@/components/ui'
import { cn } from '@/lib/utils'
import { getProviderIcon } from '@/providers/utils'
import { MODEL_CATEGORIES, MODEL_OPTIONS } from '../constants'

interface ModelSelectorProps {
  /** Currently selected model */
  selectedModel: string
  /** Whether agent prefetch (Lite mode) is enabled */
  agentPrefetch: boolean
  /** Available models filtered by user preferences */
  enabledModels: string[] | null
  /** Panel width to adjust truncation */
  panelWidth: number
  /** Whether the input is near the top of viewport (affects dropdown direction) */
  isNearTop: boolean
  /** Callback when model is selected */
  onModelSelect: (model: string) => void
  /** Callback when agent prefetch is toggled */
  onAgentPrefetchChange: (enabled: boolean) => void
  /** Callback to fetch enabled models on first open */
  onFirstOpen: () => void
}

/**
 * Gets the appropriate icon component for a model
 */
function getModelIconComponent(modelValue: string) {
  const IconComponent = getProviderIcon(modelValue)
  if (!IconComponent) {
    return null
  }
  return <IconComponent className='h-3 w-3 text-muted-foreground' />
}

/**
 * Model selector dropdown for choosing AI model and Lite mode.
 * Displays model icon and label, with purple styling for certain models.
 *
 * @param props - Component props
 * @returns Rendered model selector dropdown
 */
export function ModelSelector({
  selectedModel,
  agentPrefetch,
  enabledModels,
  panelWidth,
  isNearTop,
  onModelSelect,
  onAgentPrefetchChange,
  onFirstOpen,
}: ModelSelectorProps) {
  // Filter models based on user preferences
  const modelOptions =
    enabledModels !== null
      ? MODEL_OPTIONS.filter((model) => enabledModels.includes(model.value))
      : MODEL_OPTIONS

  const getCollapsedModeLabel = () => {
    const model = modelOptions.find((m) => m.value === selectedModel)
    return model ? model.label : 'claude-4.5-sonnet'
  }

  const getModelIcon = () => {
    const IconComponent = getProviderIcon(selectedModel)
    if (!IconComponent) {
      return null
    }
    return (
      <span className='flex-shrink-0'>
        <IconComponent className='h-3 w-3 text-muted-foreground' />
      </span>
    )
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          onFirstOpen()
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Badge className='min-w-0 max-w-full cursor-pointer rounded-[6px]' title='Choose model'>
          {getModelIcon()}
          <span className='min-w-0 truncate'>
            {getCollapsedModeLabel()}
            {agentPrefetch && !MODEL_CATEGORIES.ZAP.includes(selectedModel as any) && (
              <span className='ml-1 font-semibold'>Lite</span>
            )}
          </span>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side={isNearTop ? 'bottom' : 'top'}
        className='max-h-[400px] p-0'
      >
        <TooltipProvider delayDuration={100} skipDelayDuration={0}>
          <div className='w-[220px]'>
            <div className='max-h-[280px] overflow-y-auto p-2'>
              <div>
                <div className='mb-1'>
                  <span className='font-medium text-xs'>Model</span>
                </div>
                <div className='space-y-2'>
                  {/* Anthropic Models */}
                  <div>
                    <div className='px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase'>
                      Anthropic
                    </div>
                    <div className='space-y-0.5'>
                      {modelOptions
                        .filter((option) =>
                          [
                            'claude-4-sonnet',
                            'claude-4.5-haiku',
                            'claude-4.5-sonnet',
                            'claude-4.1-opus',
                          ].includes(option.value)
                        )
                        .map((option) => (
                          <DropdownMenuItem
                            key={option.value}
                            onSelect={() => {
                              onModelSelect(option.value)
                              // Automatically turn off Lite mode for fast models
                              if (
                                MODEL_CATEGORIES.ZAP.includes(option.value as any) &&
                                agentPrefetch
                              ) {
                                onAgentPrefetchChange(false)
                              }
                            }}
                            className={cn(
                              'flex h-7 items-center gap-1.5 px-2 py-1 text-left text-xs',
                              selectedModel === option.value ? 'bg-muted/50' : ''
                            )}
                          >
                            {getModelIconComponent(option.value)}
                            <span>{option.label}</span>
                          </DropdownMenuItem>
                        ))}
                    </div>
                  </div>

                  {/* OpenAI Models */}
                  <div>
                    <div className='px-2 py-1 font-medium text-[10px] text-muted-foreground uppercase'>
                      OpenAI
                    </div>
                    <div className='space-y-0.5'>
                      {modelOptions
                        .filter((option) =>
                          [
                            'gpt-5-fast',
                            'gpt-5',
                            'gpt-5-medium',
                            'gpt-5-high',
                            'gpt-4o',
                            'gpt-4.1',
                            'o3',
                          ].includes(option.value)
                        )
                        .map((option) => (
                          <DropdownMenuItem
                            key={option.value}
                            onSelect={() => {
                              onModelSelect(option.value)
                              // Automatically turn off Lite mode for fast models
                              if (
                                MODEL_CATEGORIES.ZAP.includes(option.value as any) &&
                                agentPrefetch
                              ) {
                                onAgentPrefetchChange(false)
                              }
                            }}
                            className={cn(
                              'flex h-7 items-center gap-1.5 px-2 py-1 text-left text-xs',
                              selectedModel === option.value ? 'bg-muted/50' : ''
                            )}
                          >
                            {getModelIconComponent(option.value)}
                            <span>{option.label}</span>
                          </DropdownMenuItem>
                        ))}
                    </div>
                  </div>

                  {/* More Models Button */}
                  <div className='mt-1 border-t pt-1'>
                    <button
                      type='button'
                      onClick={() => {
                        window.dispatchEvent(
                          new CustomEvent('open-settings', {
                            detail: { tab: 'copilot' },
                          })
                        )
                      }}
                      className='w-full rounded-sm px-2 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:bg-muted/50'
                    >
                      More Models...
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
