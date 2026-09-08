'use client'

import { ChipModalHeader } from '@sim/emcn'
import { WorkflowPreviewCanvas } from '@/app/(landing)/workflows/components/workflow-builder-preview/components/workflow-preview-canvas'

/** The saved canvas uses the same native support workflow as the visual builder preview. */
export function LogSnapshotPreview() {
  return (
    <div className='absolute top-16 left-12 w-[660px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-body)] max-sm:top-8 max-sm:left-6'>
      <ChipModalHeader onClose={() => {}}>Workflow State</ChipModalHeader>
      <div className='relative h-[330px] overflow-hidden'>
        <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 h-[376px] w-[1210px] scale-50'>
          <WorkflowPreviewCanvas />
        </div>
      </div>
    </div>
  )
}
