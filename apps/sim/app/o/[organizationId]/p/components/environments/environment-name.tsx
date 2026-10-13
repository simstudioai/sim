'use client'

import { useState } from 'react'
import { ChipInput, OverflowText, toast } from '@sim/emcn'
import { useUpdateWorkspace } from '@/hooks/queries/workspace'

interface EnvironmentNameProps {
  workspaceId: string
  name: string
  /** Shows the inline rename form; started from the card's actions menu. */
  renaming: boolean
  onRenamingChange: (renaming: boolean) => void
}

/** Renames the workspace represented by an environment without leaving its card. */
export function EnvironmentName({
  workspaceId,
  name,
  renaming,
  onRenamingChange,
}: EnvironmentNameProps) {
  if (!renaming) {
    return <OverflowText label={name} className='text-[var(--text-body)] text-small' />
  }
  return <RenameForm workspaceId={workspaceId} name={name} onDone={() => onRenamingChange(false)} />
}

interface RenameFormProps {
  workspaceId: string
  name: string
  onDone: () => void
}

function RenameForm({ workspaceId, name, onDone }: RenameFormProps) {
  const rename = useUpdateWorkspace()
  const [draft, setDraft] = useState(name)
  const commit = () => {
    if (rename.isPending) return
    const next = draft.trim()
    if (!next || next === name) {
      onDone()
      return
    }
    rename.mutate(
      { workspaceId, name: next },
      {
        onSuccess: () => {
          onDone()
          toast.success('Environment renamed')
        },
        onError: (error) => toast.error(error.message),
      }
    )
  }

  return (
    <form
      className='min-w-0 flex-1'
      onSubmit={(event) => {
        event.preventDefault()
        commit()
      }}
    >
      <ChipInput
        aria-label='Environment name'
        autoFocus
        value={draft}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !rename.isPending) {
            event.preventDefault()
            event.stopPropagation()
            onDone()
          }
        }}
        disabled={rename.isPending}
        error={Boolean(rename.error)}
      />
    </form>
  )
}
