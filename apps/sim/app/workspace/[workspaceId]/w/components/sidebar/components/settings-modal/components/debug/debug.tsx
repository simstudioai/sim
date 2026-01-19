'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Download, ExternalLink, Loader2 } from 'lucide-react'
import { createLogger } from '@sim/logger'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { workflowKeys } from '@/hooks/queries/workflows'

const logger = createLogger('DebugSettings')

interface ImportResult {
  success: boolean
  newWorkflowId?: string
  copilotChatsImported?: number
  error?: string
}

/**
 * Debug settings component for superusers.
 * Allows importing workflows by ID for debugging purposes.
 */
export function Debug() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const workspaceId = params?.workspaceId as string

  const [workflowId, setWorkflowId] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const handleImport = async () => {
    if (!workflowId.trim()) return

    setIsImporting(true)
    setResult(null)

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
        setResult({ success: false, error: data.error || 'Failed to import workflow' })
        return
      }

      // Invalidate workflow list cache to show the new workflow immediately
      await queryClient.invalidateQueries({ queryKey: workflowKeys.list(workspaceId) })

      setResult({
        success: true,
        newWorkflowId: data.newWorkflowId,
        copilotChatsImported: data.copilotChatsImported,
      })

      setWorkflowId('')
      logger.info('Workflow imported successfully', {
        originalWorkflowId: workflowId.trim(),
        newWorkflowId: data.newWorkflowId,
        copilotChatsImported: data.copilotChatsImported,
      })
    } catch (error) {
      logger.error('Failed to import workflow', error)
      setResult({ success: false, error: 'An unexpected error occurred' })
    } finally {
      setIsImporting(false)
    }
  }

  const handleNavigateToWorkflow = () => {
    if (result?.newWorkflowId) {
      router.push(`/workspace/${workspaceId}/w/${result.newWorkflowId}`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isImporting && workflowId.trim()) {
      handleImport()
    }
  }

  return (
    <div className="flex flex-col gap-6 p-1">
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" />
        <p className="text-sm text-amber-200">
          This is a superuser debug feature. Use with caution. Imported workflows and copilot chats
          will be copied to your current workspace.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <h3 className="mb-1 text-base font-medium text-white">Import Workflow by ID</h3>
          <p className="text-sm text-muted-foreground">
            Enter a workflow ID to import it along with its associated copilot chats into your
            current workspace. Only the workflow structure and copilot conversations will be copied
            - no deployments, webhooks, or triggers.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="workflow-id">Workflow ID</Label>
          <div className="flex gap-2">
            <Input
              id="workflow-id"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter workflow ID (e.g., abc123-def456-...)"
              disabled={isImporting}
              className="flex-1"
            />
            <Button onClick={handleImport} disabled={isImporting || !workflowId.trim()}>
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Import
                </>
              )}
            </Button>
          </div>
        </div>

        {result && (
          <div
            className={`rounded-lg border p-4 ${
              result.success
                ? 'border-green-500/20 bg-green-500/10'
                : 'border-red-500/20 bg-red-500/10'
            }`}
          >
            {result.success ? (
              <div className="flex flex-col gap-2">
                <p className="font-medium text-green-400">Workflow imported successfully!</p>
                <p className="text-sm text-green-300">
                  New workflow ID: <code className="font-mono">{result.newWorkflowId}</code>
                </p>
                <p className="text-sm text-green-300">
                  Copilot chats imported: {result.copilotChatsImported}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNavigateToWorkflow}
                  className="mt-2 w-fit"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open Workflow
                </Button>
              </div>
            ) : (
              <p className="text-red-400">{result.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
