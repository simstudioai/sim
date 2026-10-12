'use client'

import { useState } from 'react'
import { Chip, ChipInput, OverflowText, toast } from '@sim/emcn'
import { Pencil } from '@sim/emcn/icons'
import { useUpdateWorkspace } from '@/hooks/queries/workspace'

interface EnvironmentNameProps {
  workspaceId: string
  name: string
  canRename: boolean
}

/** Renames the workspace represented by an environment without leaving its card. */
export function EnvironmentName({ workspaceId, name, canRename }: EnvironmentNameProps) {
  const rename = useUpdateWorkspace()
  const [draft, setDraft] = useState<string | null>(null)
  const cancel = () => {
    if (rename.isPending) return
    setDraft(null)
    rename.reset()
  }

  if (!canRename) {
    return <OverflowText label={name} className='text-[var(--text-body)] text-small' />
  }

  if (draft === null) {
    return (
      <button
        type='button'
        aria-label={`Rename environment ${name}`}
        className='flex min-w-0 flex-1 items-center gap-2 rounded text-left text-[var(--text-body)] text-small hover:text-[var(--text-primary)]'
        onClick={() => setDraft(name)}
      >
        <OverflowText label={name} className='min-w-0' />
        <Pencil className='size-[14px] shrink-0 text-[var(--text-icon)]' />
      </button>
    )
  }

  return (
    <form
      className='order-last flex min-w-0 basis-full flex-col gap-2'
      onSubmit={(event) => {
        event.preventDefault()
        if (!draft.trim() || rename.isPending) return
        if (draft.trim() === name) {
          cancel()
          return
        }
        rename.mutate(
          { workspaceId, name: draft.trim() },
          {
            onSuccess: () => {
              setDraft(null)
              toast.success('Environment renamed')
            },
          }
        )
      }}
    >
      <ChipInput
        aria-label='Environment name'
        autoFocus
        value={draft}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancel()
          }
        }}
        disabled={rename.isPending}
        error={Boolean(rename.error)}
      />
      {rename.error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {rename.error.message}
        </p>
      )}
      <div className='flex gap-2'>
        <Chip type='submit' variant='primary' disabled={!draft.trim() || rename.isPending}>
          {rename.isPending ? 'Saving…' : 'Save'}
        </Chip>
        <Chip type='button' onClick={cancel} disabled={rename.isPending}>
          Cancel
        </Chip>
      </div>
    </form>
  )
}
