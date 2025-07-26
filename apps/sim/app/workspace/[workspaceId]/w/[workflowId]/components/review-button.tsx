'use client'

import { useState } from 'react'
import { Eye, FileText } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { useCopilotStore } from '@/stores/copilot/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { CopilotSandboxModal } from './copilot-sandbox-modal/copilot-sandbox-modal'

const logger = createLogger('ReviewButton')

// Backward compatibility exports (deprecated)
export function setLatestPreview() {}
export function clearLatestPreview() {}
export function getLatestUnseenPreview() {
  return null
}

export function ReviewButton() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { activeWorkflowId, createWorkflow } = useWorkflowRegistry()
  const { currentChat, updatePreviewToolCallState, clearPreviewYaml } = useCopilotStore()
  const [showModal, setShowModal] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [previewWorkflowState, setPreviewWorkflowState] = useState<any>(null)
  const [diffInfo, setDiffInfo] = useState<any>(null)
  const [isDiffLoading, setIsDiffLoading] = useState(false)

  // Check if current chat has preview YAML
  const hasPreview = currentChat?.previewYaml !== null && currentChat?.previewYaml !== undefined

  // Only show if there's a preview YAML in the current chat
  if (!hasPreview) {
    return null
  }

  const handleShowPreview = async () => {
    if (!currentChat?.previewYaml || !activeWorkflowId) return

    try {
      // Validate YAML content before sending
      const yamlContent = currentChat.previewYaml.trim()
      if (!yamlContent) {
        throw new Error('Preview YAML content is empty')
      }

      logger.info(
        'Generating preview with YAML content (first 200 chars):',
        yamlContent.substring(0, 200)
      )

      // Generate workflow state from YAML for the modal
      logger.info('Step 1: Calling preview API...')
      const previewResponse = await fetch('/api/workflows/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yamlContent,
          applyAutoLayout: true,
        }),
      })
      logger.info('Step 1 complete: Preview API response received', {
        status: previewResponse.status,
      })

      if (!previewResponse.ok) {
        const errorText = await previewResponse.text()
        logger.error('Preview API response not ok:', {
          status: previewResponse.status,
          statusText: previewResponse.statusText,
          errorText,
        })
        throw new Error(
          `Failed to generate preview: ${previewResponse.status} ${previewResponse.statusText}`
        )
      }

      const previewResult = await previewResponse.json()
      logger.info('Step 1 result: Preview API parsed successfully', {
        success: previewResult.success,
      })

      if (!previewResult.success) {
        logger.error('Preview API returned error:', previewResult)
        throw new Error(previewResult.message || 'Failed to generate preview')
      }

      // Get current workflow YAML for diff comparison
      logger.info('Step 2: Getting current workflow YAML for diff comparison...')
      let originalYaml = ''
      try {
        const currentWorkflowResponse = await fetch(`/api/tools/get-user-workflow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflowId: activeWorkflowId,
            includeMetadata: false,
          }),
        })
        logger.info('Step 2: Current workflow API response received', {
          status: currentWorkflowResponse.status,
        })

        if (currentWorkflowResponse.ok) {
          const currentWorkflowResult = await currentWorkflowResponse.json()
          logger.info('Step 2: Current workflow API parsed', {
            success: currentWorkflowResult.success,
            hasYaml: !!currentWorkflowResult.output?.yaml,
          })
          if (currentWorkflowResult.success && currentWorkflowResult.output?.yaml) {
            originalYaml = currentWorkflowResult.output.yaml
            logger.info('Step 2: Original YAML obtained', { length: originalYaml.length })
          }
        } else {
          logger.warn('Step 2: Current workflow API failed', {
            status: currentWorkflowResponse.status,
          })
        }
      } catch (yamlError) {
        logger.error('Step 2: Failed to get current workflow YAML for diff:', yamlError)
      }

      // Generate diff information if we have original YAML
      logger.info('Step 3: Generating diff information...')
      let diffResult = null
      if (originalYaml) {
        try {
          setIsDiffLoading(true)
          logger.info(
            'Step 3: Starting diff with original YAML length:',
            originalYaml.length,
            'agent YAML length:',
            yamlContent.length
          )

          const diffResponse = await fetch('/api/workflows/diff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              original_yaml: originalYaml,
              agent_yaml: yamlContent,
            }),
          })
          logger.info('Step 3: Diff API response received', { status: diffResponse.status })

          if (diffResponse.ok) {
            const diffData = await diffResponse.json()
            logger.info('Step 3: Diff API response parsed:', diffData)
            if (diffData.success) {
              diffResult = diffData.data
              logger.info('Step 3: Generated diff information successfully:', diffResult)
            } else {
              logger.error('Step 3: Diff API returned unsuccessful response:', diffData)
            }
          } else {
            logger.error(
              'Step 3: Diff API request failed:',
              diffResponse.status,
              diffResponse.statusText
            )
            const errorText = await diffResponse.text()
            logger.error('Step 3: Diff API error response:', errorText)
          }
        } catch (diffError) {
          logger.error('Step 3: Failed to generate diff information:', diffError)
        } finally {
          setIsDiffLoading(false)
        }
      } else {
        logger.warn('Step 3: No original YAML available for diff comparison')
        setIsDiffLoading(false)
      }

      // Set the generated workflow state, diff info, and open modal
      logger.info('Step 4: Setting modal state and opening...')
      setPreviewWorkflowState(previewResult.workflowState)
      setDiffInfo(diffResult)
      logger.info('Step 4: Opening modal with diff info:', diffResult)
      setShowModal(true)
      logger.info('Step 4: Modal state should now be open')
    } catch (error) {
      logger.error('Failed to generate preview for modal:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        yamlLength: currentChat?.previewYaml?.length,
        yamlPreview: currentChat?.previewYaml?.substring(0, 100),
      })
      // Reset loading states on error
      setIsDiffLoading(false)
      // TODO: Show user-friendly error message
    }
  }

  const handleApply = async () => {
    if (!currentChat?.previewYaml) return

    try {
      setIsProcessing(true)

      logger.info('Applying preview to current workflow (store-first)', {
        workflowId: activeWorkflowId,
        yamlLength: currentChat.previewYaml.length,
      })

      // STEP 1: Parse YAML and update local store immediately
      try {
        // Import the necessary modules
        const { convertYamlToWorkflowState } = await import('@/lib/workflows/yaml-converter')
        const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')
        const { useSubBlockStore } = await import('@/stores/workflows/subblock/store')

        // Convert YAML to workflow state using our unified converter
        const conversionResult = await convertYamlToWorkflowState(currentChat.previewYaml, {
          generateNewIds: false, // Keep existing IDs for preview
        })

        if (!conversionResult.success || !conversionResult.workflowState) {
          throw new Error(`Failed to convert YAML: ${conversionResult.errors.join(', ')}`)
        }

        const {
          blocks: workflowBlocks,
          edges: workflowEdges,
          loops,
          parallels,
        } = conversionResult.workflowState

        // Apply auto layout using the shared utility
        const { applyAutoLayoutToBlocks } = await import('../utils/auto-layout')
        const layoutResult = await applyAutoLayoutToBlocks(workflowBlocks, workflowEdges)

        const layoutedBlocks = layoutResult.success ? layoutResult.layoutedBlocks! : workflowBlocks

        if (layoutResult.success) {
          logger.info('Successfully applied auto layout to preview blocks')
        } else {
          logger.warn('Auto layout failed, using original positions:', layoutResult.error)
        }

        // Update workflow store immediately
        const workflowStore = useWorkflowStore.getState()
        const newWorkflowState = {
          blocks: layoutedBlocks,
          edges: workflowEdges,
          loops,
          parallels,
          lastSaved: Date.now(),
          isDeployed: workflowStore.isDeployed,
          deployedAt: workflowStore.deployedAt,
          deploymentStatuses: workflowStore.deploymentStatuses,
          hasActiveWebhook: workflowStore.hasActiveWebhook,
        }

        useWorkflowStore.setState(newWorkflowState)

        // Extract and update subblock values
        const subblockValues: Record<string, Record<string, any>> = {}
        Object.values(layoutedBlocks).forEach((block: any) => {
          if (block.subBlocks) {
            const blockValues: Record<string, any> = {}
            Object.entries(block.subBlocks).forEach(([subBlockId, subBlock]: [string, any]) => {
              if (subBlock.value !== undefined && subBlock.value !== null) {
                blockValues[subBlockId] = subBlock.value
              }
            })
            if (Object.keys(blockValues).length > 0) {
              subblockValues[block.id] = blockValues
            }
          }
        })

        // Update subblock store
        if (Object.keys(subblockValues).length > 0) {
          useSubBlockStore.setState((state) => ({
            workflowValues: {
              ...state.workflowValues,
              [activeWorkflowId!]: subblockValues,
            },
          }))
        }

        logger.info('Successfully updated local stores with preview content')
      } catch (parseError) {
        logger.error('Failed to parse and apply preview locally:', parseError)
        throw parseError
      }

      // STEP 2: Save to database (in background, don't await to keep UI responsive)
      const saveToDatabase = async () => {
        try {
          const response = await fetch(`/api/workflows/${activeWorkflowId}/yaml`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              yamlContent: currentChat.previewYaml,
              description: 'Applied copilot proposal',
              source: 'copilot',
              applyAutoLayout: true,
              createCheckpoint: true,
            }),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.message || `Failed to apply workflow: ${response.statusText}`)
          }

          const result = await response.json()

          if (!result.success) {
            throw new Error(result.message || 'Failed to apply workflow changes')
          }

          logger.info('Successfully saved preview to database')
        } catch (dbError) {
          logger.error('Failed to save preview to database (store already updated):', dbError)
          // Don't throw - the store is already updated, so the UI is correct
          // The socket will eventually sync when the database is available
        }
      }

      // Save to database without blocking UI
      saveToDatabase()

      // Clear preview YAML after successful store update (user has accepted)
      updatePreviewToolCallState('applied')
      await clearPreviewYaml()
      setShowModal(false)
      setPreviewWorkflowState(null)
      setDiffInfo(null)
      setIsDiffLoading(false)
    } catch (error) {
      logger.error('Failed to apply preview:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSaveAsNew = async (name: string) => {
    if (!currentChat?.previewYaml) {
      logger.error('No YAML content to save')
      return
    }

    try {
      setIsProcessing(true)

      logger.info('Creating new workflow from preview', {
        name,
        yamlLength: currentChat.previewYaml.length,
      })

      // First create a new workflow
      const newWorkflowId = await createWorkflow({
        name,
        description: 'Created from copilot proposal',
        workspaceId,
      })

      if (!newWorkflowId) {
        throw new Error('Failed to create new workflow')
      }

      // Then apply the YAML content to the new workflow
      const response = await fetch(`/api/workflows/${newWorkflowId}/yaml`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          yamlContent: currentChat.previewYaml,
          description: 'Created from copilot proposal',
          source: 'copilot',
          applyAutoLayout: true,
          createCheckpoint: false,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `Failed to save workflow: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.message || 'Failed to save workflow')
      }

      logger.info('Successfully created new workflow from preview')
      updatePreviewToolCallState('applied')
      await clearPreviewYaml()
      setShowModal(false)
      setPreviewWorkflowState(null)
      setDiffInfo(null)
      setIsDiffLoading(false)
    } catch (error) {
      logger.error('Failed to save preview as new workflow:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!currentChat?.previewYaml) return

    try {
      setIsProcessing(true)
      updatePreviewToolCallState('rejected')
      await clearPreviewYaml()
      setShowModal(false)
      setPreviewWorkflowState(null)
      setDiffInfo(null)
      setIsDiffLoading(false)
    } catch (error) {
      logger.error('Failed to reject preview:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    setShowModal(false)
    setPreviewWorkflowState(null)
    setDiffInfo(null)
    setIsDiffLoading(false)
  }

  // Create preview data for the sandbox modal
  const previewData =
    currentChat?.previewYaml && previewWorkflowState
      ? {
          workflowState: previewWorkflowState,
          yamlContent: currentChat.previewYaml,
          description: 'Copilot generated workflow preview',
        }
      : null

  // Debug logging
  console.log('ReviewButton render state:', {
    showModal,
    previewData: previewData ? 'present' : 'null',
    diffInfo: diffInfo ? `present (${Object.keys(diffInfo).join(',')})` : 'null',
    isDiffLoading,
    hasPreviewYaml: !!currentChat?.previewYaml,
  })

  return (
    <>
      {/* Simple button at bottom center */}
      <div className='-translate-x-1/2 fixed bottom-20 left-1/2 z-30'>
        <div className='rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur-sm'>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-2'>
              <div className='flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900'>
                <Eye className='h-4 w-4 text-purple-600 dark:text-purple-400' />
              </div>
              <span className='font-medium text-sm'>Copilot has proposed changes</span>
            </div>
            <Button
              variant='default'
              size='sm'
              onClick={handleShowPreview}
              className='h-8 bg-purple-600 px-3 hover:bg-purple-700'
            >
              <FileText className='mr-1 h-3 w-3' />
              Review Changes
            </Button>
          </div>
        </div>
      </div>

      {/* Sandbox Modal */}
      {showModal && previewData && (
        <CopilotSandboxModal
          isOpen={showModal}
          onClose={handleClose}
          proposedWorkflowState={previewData.workflowState}
          yamlContent={previewData.yamlContent}
          description={previewData.description}
          diffInfo={diffInfo}
          isDiffLoading={isDiffLoading}
          onApplyToCurrentWorkflow={handleApply}
          onSaveAsNewWorkflow={handleSaveAsNew}
          onReject={handleReject}
          isProcessing={isProcessing}
        />
      )}
    </>
  )
}
