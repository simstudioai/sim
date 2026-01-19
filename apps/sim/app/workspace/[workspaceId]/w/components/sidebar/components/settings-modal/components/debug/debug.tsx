'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { Button, Input as EmcnInput } from '@/components/emcn'
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

  const handleImport = async () => {
    if (!workflowId.trim()) return

    setIsImporting(true)

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

      if (response.ok) {
        await queryClient.invalidateQueries({ queryKey: workflowKeys.list(workspaceId) })
        setWorkflowId('')
        logger.info('Workflow imported successfully', {
          originalWorkflowId: workflowId.trim(),
          newWorkflowId: data.newWorkflowId,
          copilotChatsImported: data.copilotChatsImported,
        })
      }
    } catch (error) {
      logger.error('Failed to import workflow', error)
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className='flex h-full flex-col gap-[16px]'>
      <p className='text-[13px] text-[var(--text-secondary)]'>
        Import a workflow by ID along with its associated copilot chats.
      </p>

      <div className='flex gap-[8px]'>
        <EmcnInput
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
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
    </div>
  )
}
