'use client'

import type { ReactNode, RefObject } from 'react'
import { cn } from '@sim/emcn'
import { ModelSelector } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'

interface InputToolbarProps {
  leadingControls: ReactNode
  showModelSelector?: boolean
  selectionControl?: ReactNode
  voiceControl?: ReactNode
  beforeSubmitControl?: ReactNode
  submitControl?: ReactNode
  trailingControls?: ReactNode
  editor?: ReactNode
  expanded?: boolean
  leadingRef?: RefObject<HTMLDivElement | null>
  trailingRef?: RefObject<HTMLDivElement | null>
}

/** Shared control order for organization and workspace chat inputs. */
export function InputToolbar({
  leadingControls,
  showModelSelector = true,
  selectionControl,
  voiceControl,
  beforeSubmitControl,
  submitControl,
  trailingControls,
  editor,
  expanded = false,
  leadingRef,
  trailingRef,
}: InputToolbarProps) {
  return (
    <div
      className={
        editor
          ? '@container/input-toolbar grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-x-3'
          : '@container/input-toolbar flex flex-wrap items-center justify-between gap-y-1'
      }
    >
      <div
        ref={leadingRef}
        className={cn(
          'flex h-[30px] shrink-0 items-center @max-[280px]/input-toolbar:gap-0 gap-1',
          editor && 'col-start-1',
          editor && (expanded ? 'row-start-2' : 'row-start-1')
        )}
      >
        {leadingControls}
      </div>
      {editor && (
        <div
          className={cn('row-start-1 min-w-0', expanded ? 'col-span-3 col-start-1' : 'col-start-2')}
        >
          {editor}
        </div>
      )}
      <div
        ref={trailingRef}
        className={cn(
          'ml-auto flex h-[30px] shrink-0 items-center @max-[280px]/input-toolbar:gap-0 gap-1',
          editor && 'col-start-3',
          editor && (expanded ? 'row-start-2' : 'row-start-1')
        )}
      >
        {trailingControls ?? (
          <>
            {(selectionControl || showModelSelector || voiceControl) && (
              <div className='flex items-center gap-[inherit]'>
                {selectionControl ?? (showModelSelector && <ModelSelector />)}
                {voiceControl}
              </div>
            )}
            {beforeSubmitControl}
            {submitControl}
          </>
        )}
      </div>
    </div>
  )
}
