'use client'

import { ArrowUp, Image, Loader2 } from 'lucide-react'
import { Badge, Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { ModeSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/components/mode-selector/mode-selector'
import { ModelSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/components/model-selector/model-selector'

interface BottomControlsProps {
  mode: 'ask' | 'build' | 'plan'
  onModeChange?: (mode: 'ask' | 'build' | 'plan') => void
  selectedModel: string
  onModelSelect: (model: string) => void
  isNearTop: boolean
  disabled: boolean
  hideModeSelector: boolean
  canSubmit: boolean
  isLoading: boolean
  isAborting: boolean
  showAbortButton: boolean
  onSubmit: () => void
  onAbort: () => void
  onFileSelect: () => void
}

/**
 * Bottom controls section of the user input
 * Contains mode selector, model selector, file attachment button, and submit/abort buttons
 */
export function BottomControls({
  mode,
  onModeChange,
  selectedModel,
  onModelSelect,
  isNearTop,
  disabled,
  hideModeSelector,
  canSubmit,
  isLoading,
  isAborting,
  showAbortButton,
  onSubmit,
  onAbort,
  onFileSelect,
}: BottomControlsProps) {
  return (
    <div className='flex items-center justify-between gap-2'>
      {/* Left side: Mode Selector + Model Selector */}
      <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
        {!hideModeSelector && (
          <ModeSelector
            mode={mode}
            onModeChange={onModeChange}
            isNearTop={isNearTop}
            disabled={disabled}
          />
        )}

        <ModelSelector
          selectedModel={selectedModel}
          isNearTop={isNearTop}
          onModelSelect={onModelSelect}
        />
      </div>

      {/* Right side: Attach Button + Send Button */}
      <div className='flex flex-shrink-0 items-center gap-[10px]'>
        <Badge
          onClick={onFileSelect}
          title='Attach file'
          className={cn(
            'cursor-pointer rounded-[6px] border-0 bg-transparent p-[0px] dark:bg-transparent',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <Image className='!h-3.5 !w-3.5 scale-x-110' />
        </Badge>

        {showAbortButton ? (
          <Button
            onClick={onAbort}
            disabled={isAborting}
            className={cn(
              'h-[20px] w-[20px] rounded-full border-0 p-0 transition-colors',
              !isAborting
                ? 'bg-[var(--c-383838)] hover:bg-[var(--c-575757)] dark:bg-[var(--c-E0E0E0)] dark:hover:bg-[var(--c-CFCFCF)]'
                : 'bg-[var(--c-383838)] dark:bg-[var(--c-E0E0E0)]'
            )}
            title='Stop generation'
          >
            {isAborting ? (
              <Loader2 className='block h-[13px] w-[13px] animate-spin text-white dark:text-black' />
            ) : (
              <svg
                className='block h-[13px] w-[13px] fill-white dark:fill-black'
                viewBox='0 0 24 24'
                xmlns='http://www.w3.org/2000/svg'
              >
                <rect x='4' y='4' width='16' height='16' rx='3' ry='3' />
              </svg>
            )}
          </Button>
        ) : (
          <Button
            onClick={onSubmit}
            disabled={!canSubmit}
            className={cn(
              'h-[22px] w-[22px] rounded-full border-0 p-0 transition-colors',
              canSubmit
                ? 'bg-[var(--c-383838)] hover:bg-[var(--c-575757)] dark:bg-[var(--c-E0E0E0)] dark:hover:bg-[var(--c-CFCFCF)]'
                : 'bg-[var(--c-808080)] dark:bg-[var(--c-808080)]'
            )}
          >
            {isLoading ? (
              <Loader2 className='block h-3.5 w-3.5 animate-spin text-white dark:text-black' />
            ) : (
              <ArrowUp
                className='block h-3.5 w-3.5 text-white dark:text-black'
                strokeWidth={2.25}
              />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
