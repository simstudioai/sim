'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Button, Input as EmcnInput } from '@/components/emcn'
import { DebugSkeleton } from '@/app/workspace/[workspaceId]/settings/components/debug/debug-skeleton'
import { useImportWorkflow } from '@/hooks/queries/workflows'

/**
 * Debug settings component for superusers.
 * Allows importing workflows by ID for debugging purposes.
 */
export function Debug() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const [workflowId, setWorkflowId] = useState('')
  const importWorkflow = useImportWorkflow()

  const handleImport = () => {
    if (!workflowId.trim()) return

    importWorkflow.mutate(
      {
        workflowId: workflowId.trim(),
        targetWorkspaceId: workspaceId,
      },
      {
        onSuccess: () => {
          setWorkflowId('')
        },
      }
    )
  }

  return (
    <div className='flex h-full flex-col gap-[18px]'>
      <p className='text-[14px] text-[var(--text-secondary)]'>
        Import a workflow by ID along with its associated copilot chats.
      </p>

      <div className='flex gap-[8px]'>
        <EmcnInput
          value={workflowId}
          onChange={(e) => {
            setWorkflowId(e.target.value)
            importWorkflow.reset()
          }}
          placeholder='Enter workflow ID'
          disabled={importWorkflow.isPending}
        />
        <Button
          variant='tertiary'
          onClick={handleImport}
          disabled={importWorkflow.isPending || !workflowId.trim()}
        >
          {importWorkflow.isPending ? 'Importing...' : 'Import'}
        </Button>
      </div>

      {importWorkflow.isPending && <DebugSkeleton />}

      {importWorkflow.error && (
        <p className='text-[13px] text-[var(--text-error)]'>{importWorkflow.error.message}</p>
      )}

      {importWorkflow.isSuccess && (
        <p className='text-[13px] text-[var(--text-secondary)]'>
          Workflow imported successfully (new ID: {importWorkflow.data.newWorkflowId},{' '}
          {importWorkflow.data.copilotChatsImported ?? 0} copilot chats imported)
        </p>
      )}
    </div>
  )
}
