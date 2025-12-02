'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createLogger } from '@/lib/logs/console/logger'
import { parseWorkflowJson } from '@/stores/workflows/json/importer'
import { useCreateWorkflow, workflowKeys } from '@/hooks/queries/workflows'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSuperUserStatus } from '@/hooks/queries/super-user'

const logger = createLogger('WorkflowImport')

/**
 * WorkflowImport Settings Component
 * Allows superusers to import workflows by ID from the database
 */
export function WorkflowImport() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const createWorkflowMutation = useCreateWorkflow()
  const { data: superUserData, isLoading: loadingSuperUser } = useSuperUserStatus()
  
  const workspaceId = params?.workspaceId as string
  const isSuperUser = superUserData?.isSuperUser ?? false
  
  const [workflowId, setWorkflowId] = useState('')
  const [useDeployment, setUseDeployment] = useState(false)
  const [deployments, setDeployments] = useState<any[]>([])
  const [selectedDeployment, setSelectedDeployment] = useState<string>('')
  const [loadingDeployments, setLoadingDeployments] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Fetch deployments when workflow ID changes and useDeployment is enabled
  useEffect(() => {
    const fetchDeployments = async () => {
      if (!useDeployment || !workflowId.trim()) {
        setDeployments([])
        setSelectedDeployment('')
        return
      }

      setLoadingDeployments(true)
      setError(null)

      try {
        const response = await fetch(`/api/admin/workflow-deployments?workflowId=${workflowId.trim()}`)
        
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to fetch deployments')
        }

        const data = await response.json()
        setDeployments(data.versions || [])
        
        if (data.versions && data.versions.length > 0) {
          setSelectedDeployment(String(data.versions[0].version))
        } else {
          setSelectedDeployment('')
        }
      } catch (err) {
        logger.error('Failed to fetch deployments:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch deployments')
        setDeployments([])
        setSelectedDeployment('')
      } finally {
        setLoadingDeployments(false)
      }
    }

    fetchDeployments()
  }, [useDeployment, workflowId])

  /**
   * Handle workflow import
   */
  const handleImport = async () => {
    if (!workflowId.trim()) {
      setError('Please enter a workflow ID')
      return
    }

    setIsImporting(true)
    setError(null)
    setSuccess(null)

    try {
      // Build request
      const requestBody: any = {
        workflowId: workflowId.trim(),
        targetWorkspaceId: workspaceId,
      }

      if (useDeployment && selectedDeployment) {
        requestBody.deploymentVersion = Number.parseInt(selectedDeployment, 10)
      }

      // Fetch workflow data from admin API
      const response = await fetch('/api/admin/import-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch workflow')
      }

      const { workflow: exportState, metadata } = await response.json()

      // Parse the workflow JSON (regenerate IDs)
      const { data: workflowData, errors: parseErrors } = parseWorkflowJson(
        JSON.stringify(exportState),
        true
      )

      if (!workflowData || parseErrors.length > 0) {
        throw new Error(`Failed to parse workflow: ${parseErrors.join(', ')}`)
      }

      // Clear diff state
      useWorkflowDiffStore.getState().clearDiff()

      // Create new workflow
      const importSuffix = metadata.deploymentVersion 
        ? ` (Imported v${metadata.deploymentVersion})` 
        : ' (Imported)'
      
      const workflowColor = exportState.state?.metadata?.color || '#3972F6'
      
      const result = await createWorkflowMutation.mutateAsync({
        name: `${metadata.originalName}${importSuffix}`,
        description: metadata.originalDescription || `Imported from ${metadata.source}`,
        workspaceId,
        color: workflowColor,
      })
      const newWorkflowId = result.id

      // Save workflow state
      const stateResponse = await fetch(`/api/workflows/${newWorkflowId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowData),
      })

      if (!stateResponse.ok) {
        // Clean up on failure
        await fetch(`/api/workflows/${newWorkflowId}`, { method: 'DELETE' })
        throw new Error('Failed to save workflow state')
      }

      // Save variables if present
      if (workflowData.variables && Array.isArray(workflowData.variables) && workflowData.variables.length > 0) {
        const variablesPayload = workflowData.variables.map((v: any) => ({
          id: v.id,
          workflowId: newWorkflowId,
          name: v.name,
          type: v.type,
          value: v.value,
        }))

        await fetch(`/api/workflows/${newWorkflowId}/variables`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: variablesPayload }),
        })
      }

      // Refresh workflow list
      await queryClient.invalidateQueries({ queryKey: workflowKeys.list(workspaceId) })

      const successMsg = metadata.deploymentVersion
        ? `Imported "${metadata.originalName}" v${metadata.deploymentVersion}`
        : `Imported "${metadata.originalName}"`
      
      setSuccess(successMsg)
      setWorkflowId('')

      // Navigate to new workflow
      setTimeout(() => {
        router.push(`/workspace/${workspaceId}/w/${newWorkflowId}`)
      }, 1000)
    } catch (err) {
      logger.error('Failed to import workflow:', err)
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  if (loadingSuperUser) {
    return (
      <div className='flex h-full items-center justify-center'>
        <Loader2 className='h-6 w-6 animate-spin text-[var(--text-40)]' />
      </div>
    )
  }

  if (!isSuperUser) {
    return (
      <div className='flex h-full items-center justify-center'>
        <p className='text-[var(--text-40)]'>This feature is only available to superusers.</p>
      </div>
    )
  }

  return (
    <div className='h-full overflow-y-auto p-6'>
      <div className='mx-auto max-w-2xl space-y-6'>
        <div>
          <h2 className='text-lg font-semibold text-[var(--text-90)]'>Import Workflow</h2>
          <p className='mt-1 text-sm text-[var(--text-40)]'>
            Import a workflow from the database by ID into this workspace.
          </p>
        </div>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='workflow-id'>Workflow ID</Label>
            <Input
              id='workflow-id'
              placeholder='Enter workflow ID'
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              disabled={isImporting}
              className='font-mono'
            />
          </div>

          <div className='flex items-center justify-between rounded-md border border-[var(--surface-11)] p-3'>
            <div>
              <Label htmlFor='use-deployment'>Load from deployment</Label>
              <p className='text-xs text-[var(--text-40)]'>Import a deployed version</p>
            </div>
            <Switch
              id='use-deployment'
              checked={useDeployment}
              onCheckedChange={setUseDeployment}
              disabled={isImporting}
            />
          </div>

          {useDeployment && (
            <div className='space-y-2'>
              <Label>Deployment Version</Label>
              {loadingDeployments ? (
                <div className='flex items-center gap-2 rounded-md border border-[var(--surface-11)] p-3 text-sm text-[var(--text-40)]'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Loading...
                </div>
              ) : deployments.length === 0 ? (
                <div className='rounded-md border border-[var(--surface-11)] p-3 text-sm text-[var(--text-40)]'>
                  {workflowId.trim() ? 'No deployments found' : 'Enter a workflow ID'}
                </div>
              ) : (
                <Select value={selectedDeployment} onValueChange={setSelectedDeployment} disabled={isImporting}>
                  <SelectTrigger>
                    <SelectValue placeholder='Select version' />
                  </SelectTrigger>
                  <SelectContent>
                    {deployments.map((d) => (
                      <SelectItem key={d.version} value={String(d.version)}>
                        v{d.version}{d.name ? ` - ${d.name}` : ''}{d.isActive ? ' (Active)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {error && (
            <div className='rounded-md bg-red-500/10 p-3 text-sm text-red-500'>{error}</div>
          )}

          {success && (
            <div className='rounded-md bg-green-500/10 p-3 text-sm text-green-500'>{success}</div>
          )}

          <Button
            onClick={handleImport}
            disabled={isImporting || !workflowId.trim() || (useDeployment && !selectedDeployment)}
            className='w-full'
          >
            {isImporting ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Importing...
              </>
            ) : (
              <>
                <Download className='mr-2 h-4 w-4' />
                Import Workflow
              </>
            )}
          </Button>
        </div>

        <div className='rounded-md border border-yellow-500/20 bg-yellow-500/5 p-4'>
          <p className='text-xs text-yellow-600 dark:text-yellow-500'>
            ⚠️ Superuser Only - Use responsibly
          </p>
        </div>
      </div>
    </div>
  )
}

