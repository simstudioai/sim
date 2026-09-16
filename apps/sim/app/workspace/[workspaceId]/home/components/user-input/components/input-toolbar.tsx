'use client'

import type { ReactNode } from 'react'
import { ModelSelector } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'

interface InputToolbarProps {
  leadingControls: ReactNode
  showModelSelector?: boolean
  voiceControl?: ReactNode
  beforeSubmitControl?: ReactNode
  submitControl: ReactNode
}

/** Shared control order for organization and workspace chat inputs. */
export function InputToolbar({
  leadingControls,
  showModelSelector = true,
  voiceControl,
  beforeSubmitControl,
  submitControl,
}: InputToolbarProps) {
  return (
    <div className='flex items-center justify-between'>
      <div className='flex items-center gap-1'>{leadingControls}</div>
      <div className='flex items-center gap-1.5'>
        {showModelSelector && <ModelSelector />}
        {voiceControl}
        {beforeSubmitControl}
        {submitControl}
      </div>
    </div>
  )
}
