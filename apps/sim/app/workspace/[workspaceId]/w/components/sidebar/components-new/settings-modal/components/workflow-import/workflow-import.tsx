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

  /**
   * Fetch deployments when workflow ID changes and useDeployment is enabled
   */
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
        
        // Auto-select the first (most recent) deployment
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
      // Call the admin API to get the workflow data
      const requestBody: any = {
        workflowId: workflowId.trim(),
        targetWorkspaceId: workspaceId,
      }

      // Add deployment version if selected
      if (useDeployment && selectedDeployment) {
        requestBody.deploymentVersion = Number.parseInt(selectedDeployment, 10)
      }

      const response = await fetch('/api/admin/import-workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to import workflow')
      }

      const { workflow: exportState, metadata } = await response.json()

      // Parse the exported workflow
      const { data: workflowData, errors: parseErrors } = parseWorkflowJson(
        JSON.stringify(exportState),
        true // regenerate IDs
      )

      if (!workflowData || parseErrors.length > 0) {
        logger.warn('Failed to parse imported workflow:', parseErrors)
        throw new Error(`Failed to parse workflow: ${parseErrors.join(', ')}`)
      }

      // Validate workflow data structure
      if (!workflowData.blocks || typeof workflowData.blocks !== 'object') {
        throw new Error('Invalid workflow data: missing or invalid blocks')
      }

      if (!Array.isArray(workflowData.edges)) {
        throw new Error('Invalid workflow data: missing or invalid edges array')
      }

      // Ensure all blocks have required fields
      const blockEntries = Object.entries(workflowData.blocks)
      for (const [blockId, block] of blockEntries) {
        if (!block || typeof block !== 'object') {
          throw new Error(`Invalid block data for block ${blockId}`)
        }
        if (!block.id || !block.type) {
          throw new Error(`Block ${blockId} is missing required fields (id, type)`)
        }
      }

      logger.info('Workflow data validated successfully', {
        blockCount: blockEntries.length,
        edgeCount: workflowData.edges.length,
      })

      // Clear diff state
      useWorkflowDiffStore.getState().clearDiff()

      // Create new workflow - just like normal import
      const importSuffix = metadata.deploymentVersion 
        ? ` (Imported v${metadata.deploymentVersion})` 
        : ' (Imported)'
      
      const workflowColor = exportState.state?.metadata?.color || '#3972F6'
      
      const result = await createWorkflowMutation.mutateAsync({
        name: `${metadata.originalName}${importSuffix}`,
        description: metadata.originalDescription || `Imported via superuser tools from ${metadata.source}`,
        workspaceId,
        color: workflowColor,
      })
      const newWorkflowId = result.id

      // Save workflow state - simple, like normal import
      logger.info('Saving workflow state...', { workflowId: newWorkflowId })
      
      const stateResponse = await fetch(`/api/workflows/${newWorkflowId}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workflowData),
      })

      if (!stateResponse.ok) {
        const errorText = await stateResponse.text()
        logger.error('Failed to save workflow state:', errorText)
        
        // Clean up the created workflow
        await fetch(`/api/workflows/${newWorkflowId}`, {
          method: 'DELETE',
        })
        
        throw new Error(`Failed to save imported workflow state: ${errorText}`)
      }

      logger.info('Workflow state saved successfully')

      // Save variables if present - like normal import
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
        
        logger.info('Variables saved successfully')
      }

      // Invalidate queries to refresh the workflow list
      await queryClient.invalidateQueries({ queryKey: workflowKeys.list(workspaceId) })

      logger.info('Successfully imported workflow', {
        originalId: metadata.originalId,
        newId: newWorkflowId,
        name: metadata.originalName,
        source: metadata.source,
      })

      const successMessage = metadata.deploymentVersion
        ? `Successfully imported workflow "${metadata.originalName}" v${metadata.deploymentVersion} (ID: ${newWorkflowId})`
        : `Successfully imported workflow "${metadata.originalName}" (ID: ${newWorkflowId})`
      
      setSuccess(successMessage)
      setWorkflowId('')

      // Navigate to the new workflow after a short delay
      setTimeout(() => {
        router.push(`/workspace/${workspaceId}/w/${newWorkflowId}`)
      }, 1500)
    } catch (err) {
      logger.error('Failed to import workflow:', err)
      setError(err instanceof Error ? err.message : 'Unknown error occurred')
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
        <div className='text-center'>
          <p className='text-[var(--text-40)]'>This feature is only available to superusers.</p>
        </div>
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
            <Label htmlFor='workflow-id' className='text-sm font-medium text-[var(--text-80)]'>
              Workflow ID
            </Label>
            <Input
              id='workflow-id'
              type='text'
              placeholder='Enter workflow ID (e.g., abc123...)'
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              disabled={isImporting}
              className='font-mono'
            />
          </div>

          <div className='flex items-center justify-between rounded-md border border-[var(--surface-11)] p-3'>
            <div className='space-y-0.5'>
              <Label htmlFor='use-deployment' className='text-sm font-medium text-[var(--text-80)]'>
                Load from deployment
              </Label>
              <p className='text-xs text-[var(--text-40)]'>
                Import a deployed version instead of the current state
              </p>
            </div>
            <Switch
              id='use-deployment'
              checked={useDeployment}
              onCheckedChange={(checked) => {
                setUseDeployment(checked)
                if (!checked) {
                  setDeployments([])
                  setSelectedDeployment('')
                }
              }}
              disabled={isImporting}
            />
          </div>

          {useDeployment && (
            <div className='space-y-2'>
              <Label htmlFor='deployment-version' className='text-sm font-medium text-[var(--text-80)]'>
                Deployment Version
              </Label>
              {loadingDeployments ? (
                <div className='flex items-center gap-2 rounded-md border border-[var(--surface-11)] p-3 text-sm text-[var(--text-40)]'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Loading deployments...
                </div>
              ) : deployments.length === 0 ? (
                <div className='rounded-md border border-[var(--surface-11)] p-3 text-sm text-[var(--text-40)]'>
                  {workflowId.trim() 
                    ? 'No deployments found for this workflow' 
                    : 'Enter a workflow ID to load deployments'}
                </div>
              ) : (
                <>
                  <Select
                    value={selectedDeployment}
                    onValueChange={setSelectedDeployment}
                    disabled={isImporting}
                  >
                    <SelectTrigger id='deployment-version'>
                      <SelectValue placeholder='Select a deployment version' />
                    </SelectTrigger>
                    <SelectContent>
                      {deployments.map((deployment) => (
                        <SelectItem key={deployment.version} value={String(deployment.version)}>
                          v{deployment.version}
                          {deployment.name && ` - ${deployment.name}`}
                          {deployment.isActive && ' (Active)'}
                          {' · '}
                          {new Date(deployment.createdAt).toLocaleDateString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className='text-xs text-[var(--text-40)]'>
                    {deployments.length} deployment{deployments.length === 1 ? '' : 's'} available
                  </p>
                </>
              )}
            </div>
          )}

          {error && (
            <div className='rounded-md bg-red-500/10 p-3 text-sm text-red-500'>
              <p className='font-medium'>Error</p>
              <p className='mt-1'>{error}</p>
            </div>
          )}

          {success && (
            <div className='rounded-md bg-green-500/10 p-3 text-sm text-green-500'>
              <p className='font-medium'>Success</p>
              <p className='mt-1'>{success}</p>
            </div>
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
      </div>
    </div>
  )
}

