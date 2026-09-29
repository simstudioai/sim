'use client'

import { useState } from 'react'
import { Chip, ChipCombobox, ChipInput, ChipTextarea } from '@sim/emcn'
import { useCreateBenchmark } from '@/hooks/queries/benchmarks'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

interface CreateBenchmarkProps {
  organizationId: string
  onCreated: (benchmarkId: string) => void
}

export function CreateBenchmark({ organizationId, onCreated }: CreateBenchmarkProps) {
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState('')
  const [name, setName] = useState('')
  const [taskBrief, setTaskBrief] = useState('')
  const workspaces = useWorkspacesQuery()
  const createBenchmark = useCreateBenchmark(organizationId)
  const options = (workspaces.data ?? [])
    .filter((workspace) => workspace.organizationId === organizationId)
    .map((workspace) => ({ value: workspace.id, label: workspace.name }))

  return (
    <form
      className='flex flex-col gap-5'
      onSubmit={(event) => {
        event.preventDefault()
        if (!sourceWorkspaceId || !name.trim() || createBenchmark.isPending) return
        createBenchmark.mutate(
          { sourceWorkspaceId, name: name.trim(), taskBrief: taskBrief.trim() },
          { onSuccess: ({ benchmark }) => onCreated(benchmark.id) }
        )
      }}
    >
      <div className='flex flex-col gap-1.5'>
        <label htmlFor='benchmark-workspace' className='text-[var(--text-body)] text-small'>
          Source workspace
        </label>
        <ChipCombobox
          id='benchmark-workspace'
          aria-label='Source workspace'
          options={options}
          value={sourceWorkspaceId}
          onChange={setSourceWorkspaceId}
          placeholder='Select a workspace'
          searchable
          isLoading={workspaces.isLoading}
          error={workspaces.error?.message}
          disabled={createBenchmark.isPending}
        />
        <p className='text-[var(--text-muted)] text-small'>
          Its completed workflows provide the reference. The planner explores your enterprise
          sources without access to those workflows.
        </p>
      </div>
      <div className='flex flex-col gap-1.5'>
        <label htmlFor='benchmark-name' className='text-[var(--text-body)] text-small'>
          Name
        </label>
        <ChipInput
          id='benchmark-name'
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder='Customer escalation planning'
          maxLength={200}
          required
          disabled={createBenchmark.isPending}
        />
      </div>
      <div className='flex flex-col gap-1.5'>
        <label htmlFor='benchmark-brief' className='text-[var(--text-body)] text-small'>
          Task brief
        </label>
        <ChipTextarea
          id='benchmark-brief'
          value={taskBrief}
          onChange={(event) => setTaskBrief(event.target.value)}
          placeholder='Paste the original request, or generate a brief from the workspace in step 1.'
          rows={4}
          maxLength={20_000}
          resizable
          disabled={createBenchmark.isPending}
        />
      </div>
      {createBenchmark.error && (
        <p role='alert' className='text-[var(--text-error)] text-small'>
          {createBenchmark.error.message}
        </p>
      )}
      <div>
        <Chip
          type='submit'
          variant='primary'
          disabled={!sourceWorkspaceId || !name.trim() || createBenchmark.isPending}
        >
          {createBenchmark.isPending ? 'Creating…' : 'Create benchmark'}
        </Chip>
      </div>
    </form>
  )
}
