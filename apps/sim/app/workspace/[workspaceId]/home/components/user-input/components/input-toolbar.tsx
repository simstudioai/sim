'use client'

import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import {
  ModelSelector,
  type ModelSelectorOptions,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'

interface InputToolbarProps {
  leadingControls: ReactNode
  showModelSelector?: boolean
  plan?: boolean
  modelSelectorOptions?: ModelSelectorOptions
  voiceControl?: ReactNode
  beforeSubmitControl?: ReactNode
  submitControl?: ReactNode
  trailingControls?: ReactNode
  editor?: ReactNode
  expanded?: boolean
}

/** Shared control order for organization and workspace chat inputs. */
export function InputToolbar({
  leadingControls,
  showModelSelector = true,
  plan = false,
  modelSelectorOptions,
  voiceControl,
  beforeSubmitControl,
  submitControl,
  trailingControls,
  editor,
  expanded = false,
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
        className={cn(
          'flex min-h-[30px] shrink-0 items-center @max-[280px]/input-toolbar:gap-0 gap-1',
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
        className={cn(
          'ml-auto flex min-h-[30px] shrink-0 items-center @max-[280px]/input-toolbar:gap-0 gap-1',
          editor && 'col-start-3',
          editor && (expanded ? 'row-start-2' : 'row-start-1')
        )}
      >
        {trailingControls ?? (
          <>
            {(showModelSelector || voiceControl) && (
              <div className='flex items-center gap-[inherit]'>
                {showModelSelector && <ModelSelector plan={plan} {...modelSelectorOptions} />}
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
