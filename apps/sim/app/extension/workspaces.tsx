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
import { isApiClientError } from '@/lib/api/client/errors'
import ExtensionLoading from '@/app/extension/loading'
import { ExtensionSignIn } from '@/app/extension/sign-in'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

export function ExtensionWorkspaces() {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  const scrollEdges = useScrollEdges(scrollElement)
  const { data: workspaces, isPending, error, refetch } = useWorkspacesQuery()
  if (isApiClientError(error) && error.status === 401) return <ExtensionSignIn />
  if (isPending) return <ExtensionLoading />
  const transientError =
    !isApiClientError(error) || error.status === 408 || error.status === 429 || error.status >= 500
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
        {error && (!workspaces || !transientError) ? (
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
