'use client'

import { useState } from 'react'
import { ChipModal, ChipModalBody, ChipModalHeader, OverflowText } from '@sim/emcn'
import Link from 'next/link'
import type { ChangelogReleaseWorkflow } from '@/lib/api/contracts/changelog'

interface ReleaseWorkflowsProps {
  workspaceId: string
  workflows: ChangelogReleaseWorkflow[]
}

/** "N workflows deployed" (or "changed" when some shipped no deployment), opening each workflow's version. */
export function ReleaseWorkflows({ workspaceId, workflows }: ReleaseWorkflowsProps) {
  const [open, setOpen] = useState(false)
  if (workflows.length === 0) return null
  const allDeployed = workflows.every((workflow) => workflow.deploymentVersion !== null)
  const label = `${workflows.length} ${workflows.length === 1 ? 'workflow' : 'workflows'} ${allDeployed ? 'deployed' : 'changed'}`

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='w-fit text-left text-[var(--text-muted)] text-small underline-offset-4 transition-colors hover:text-[var(--text-body)] hover:underline'
      >
        {label}
      </button>
      <ChipModal open={open} onOpenChange={setOpen} srTitle={label} size='sm'>
        <ChipModalHeader onClose={() => setOpen(false)}>{label}</ChipModalHeader>
        <ChipModalBody>
          <ul className='flex flex-col px-2'>
            {workflows.map((workflow) => (
              <li
                key={workflow.id}
                className='flex items-center gap-3 border-[var(--border)] border-b py-2.5 last:border-b-0'
              >
                <Link
                  href={`/workspace/${workspaceId}/w/${workflow.id}`}
                  className='flex min-w-0 flex-1 underline-offset-4 hover:underline'
                >
                  <OverflowText label={workflow.name} className='text-[var(--text-body)] text-sm' />
                </Link>
                <span className='shrink-0 text-[var(--text-muted)] text-small'>
                  {workflow.deploymentVersion === null
                    ? 'Not deployed'
                    : `Version ${workflow.deploymentVersion}`}
                </span>
              </li>
            ))}
          </ul>
        </ChipModalBody>
      </ChipModal>
    </>
  )
}
