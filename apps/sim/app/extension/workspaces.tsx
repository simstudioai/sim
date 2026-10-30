'use client'

import { useState } from 'react'
import {
  Chip,
  ChipLink,
  cn,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import ExtensionLoading from '@/app/extension/loading'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

export function ExtensionWorkspaces() {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  const scrollEdges = useScrollEdges(scrollElement)
  const { data: workspaces, isPending, error, refetch } = useWorkspacesQuery()
  if (isPending) return <ExtensionLoading />
  return (
    <main
      ref={setScrollElement}
      {...scrollFadeAttributes(scrollEdges)}
      className={cn(
        'h-dvh overflow-y-auto bg-[var(--bg)] p-4 text-[var(--text-body)] text-small',
        scrollFadeClass
      )}
    >
      <div className='flex flex-col gap-4'>
        <h1 className='text-lg'>Choose a workspace</h1>
        {error ? (
          <Chip onClick={() => void refetch()}>Retry loading workspaces</Chip>
        ) : workspaces?.length ? (
          <nav className='flex flex-col gap-2' aria-label='Workspaces'>
            {workspaces.map((workspace) => (
              <ChipLink
                key={workspace.id}
                href={`/extension/${encodeURIComponent(workspace.id)}`}
                variant='border'
              >
                {workspace.name}
              </ChipLink>
            ))}
          </nav>
        ) : (
          <ChipLink href='/home' target='_blank' rel='noopener noreferrer'>
            Open Sim to create a workspace
          </ChipLink>
        )}
      </div>
    </main>
  )
}
