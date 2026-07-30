import { ChipLink } from '@sim/emcn'
import { CircleAlert } from '@sim/emcn/icons'

export function WorkspaceAccessDenied() {
  return (
    <main className='flex min-h-screen items-center justify-center bg-[var(--surface-1)] p-6'>
      <div className='flex max-w-md flex-col items-center gap-3 text-center'>
        <div className='flex size-10 items-center justify-center rounded-full bg-[var(--surface-3)]'>
          <CircleAlert className='size-[18px] text-[var(--text-icon)]' aria-hidden />
        </div>
        <div className='space-y-1'>
          <h1 className='font-medium text-[var(--text-primary)] text-lg'>
            Workspace access denied
          </h1>
          <p className='text-[var(--text-muted)] text-sm'>
            You do not have access to this workspace. Ask a workspace administrator for access or
            choose another workspace.
          </p>
        </div>
        <ChipLink href='/workspace' variant='primary'>
          View your workspaces
        </ChipLink>
      </div>
    </main>
  )
}
