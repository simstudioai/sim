'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { Button, Input as EmcnInput } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { workflowKeys } from '@/hooks/queries/workflows'

const logger = createLogger('DebugSettings')

/**
 * Debug settings component for superusers.
 * Allows importing workflows by ID for debugging purposes.
 */
export function Debug() {
  const params = useParams()
  const queryClient = useQueryClient()
  const workspaceId = params?.workspaceId as string

  const [workflowId, setWorkflowId] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)

  const handleImport = async () => {
    if (!workflowId.trim()) return

    setIsImporting(true)
    setImportError(null)
    setImportSuccess(null)

    try {
      const response = await fetch('/api/superuser/import-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: workflowId.trim(),
          targetWorkspaceId: workspaceId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        const message = data?.error || `Import failed with status ${response.status}`
        setImportError(message)
        logger.error('Failed to import workflow', { status: response.status, error: message })
        return
      }

      await queryClient.invalidateQueries({ queryKey: workflowKeys.list(workspaceId) })
      setWorkflowId('')
      setImportSuccess(
        `Workflow imported successfully (new ID: ${data.newWorkflowId}, ${data.copilotChatsImported ?? 0} copilot chats imported)`
      )
      logger.info('Workflow imported successfully', {
        originalWorkflowId: workflowId.trim(),
        newWorkflowId: data.newWorkflowId,
        copilotChatsImported: data.copilotChatsImported,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred'
      setImportError(message)
      logger.error('Failed to import workflow', { error })
    } finally {
      setIsImporting(false)
    }
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
            setImportError(null)
            setImportSuccess(null)
          }}
          placeholder='Enter workflow ID'
          disabled={isImporting}
        />
        <Button
          variant='tertiary'
          onClick={handleImport}
          disabled={isImporting || !workflowId.trim()}
        >
          {isImporting ? 'Importing...' : 'Import'}
        </Button>
      </div>

      {isImporting && <DebugSkeleton />}

      {importError && <p className='text-[13px] text-[var(--text-error)]'>{importError}</p>}

      {importSuccess && <p className='text-[13px] text-[var(--text-secondary)]'>{importSuccess}</p>}
    </div>
  )
}

/**
 * Loading skeleton displayed during workflow import.
 */
function DebugSkeleton() {
  return (
    <div className='flex flex-col gap-[8px]'>
      <Skeleton className='h-5 w-[200px]' />
      <Skeleton className='h-5 w-[140px]' />
    </div>
  )
}
