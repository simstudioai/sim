'use client'

import { Chip, ChipLink } from '@sim/emcn'
import ExtensionLoading from '@/app/extension/loading'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

export function ExtensionWorkspaces() {
  const { data: workspaces, isPending, error, refetch } = useWorkspacesQuery()
  if (isPending) return <ExtensionLoading />
  return (
    <main className='flex h-dvh flex-col gap-4 overflow-y-auto bg-[var(--bg)] p-4 text-[var(--text-body)] text-small'>
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
    </main>
  )
}
