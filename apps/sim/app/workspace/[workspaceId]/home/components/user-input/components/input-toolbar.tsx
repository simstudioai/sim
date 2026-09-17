'use client'

import type { ReactNode, RefObject } from 'react'
import { cn } from '@sim/emcn'
import { ModelSelector } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'

interface InputToolbarProps {
  leadingControls: ReactNode
  showModelSelector?: boolean
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
          ? 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-x-3'
          : 'flex items-center justify-between'
      }
    >
      <div
        ref={leadingRef}
        className={cn(
          'flex h-[30px] items-center',
          editor ? 'col-start-1 gap-3' : 'gap-1',
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
          'flex h-[30px] items-center gap-1.5',
          editor && 'col-start-3',
          editor && (expanded ? 'row-start-2' : 'row-start-1')
        )}
      >
        {trailingControls ?? (
          <>
            {showModelSelector && <ModelSelector />}
            {voiceControl}
            {beforeSubmitControl}
            {submitControl}
          </>
        )}
      </div>
    </div>
  )
}
