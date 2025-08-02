'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { simAgentClient } from '@/lib/sim-agent'
import { getAllBlocks } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { resolveOutputType } from '@/blocks/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const logger = createLogger('ImportControls')

interface ImportControlsProps {
  disabled?: boolean
  onClose?: () => void
}

export interface ImportControlsRef {
  triggerFileUpload: () => void
}

export const ImportControls = forwardRef<ImportControlsRef, ImportControlsProps>(
  ({ disabled = false, onClose }, ref) => {
    const [isImporting, setIsImporting] = useState(false)
    const [yamlContent, setYamlContent] = useState('')
    const [importResult, setImportResult] = useState<{
      success: boolean
      errors: string[]
      warnings: string[]
      summary?: string
    } | null>(null)

    const fileInputRef = useRef<HTMLInputElement>(null)
    const router = useRouter()
    const params = useParams()
    const workspaceId = params.workspaceId as string

    // Stores and hooks
    const { createWorkflow } = useWorkflowRegistry()

    // Expose methods to parent component
    useImperativeHandle(ref, () => ({
      triggerFileUpload: () => {
        fileInputRef.current?.click()
      },
    }))

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      try {
        const content = await file.text()
        setYamlContent(content)

        // Import directly without showing the modal
        await handleDirectImport(content)
        onClose?.()
      } catch (error) {
        logger.error('Failed to read file:', error)
        setImportResult({
          success: false,
          errors: [
            `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ],
          warnings: [],
        })
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }

    const handleDirectImport = async (content: string) => {
      if (!content.trim()) {
        setImportResult({
          success: false,
          errors: ['YAML content is required'],
          warnings: [],
        })
        return
      }

      setIsImporting(true)
      setImportResult(null)

      try {
        // First validate the YAML without importing
        // Gather block registry and utilities for sim-agent
        const blocks = getAllBlocks()
        const blockRegistry = blocks.reduce(
          (acc, block) => {
            const blockType = block.type
            acc[blockType] = {
              ...block,
              id: blockType,
              subBlocks: block.subBlocks || [],
              outputs: block.outputs || {},
            } as any
            return acc
          },
          {} as Record<string, BlockConfig>
        )

        const parseResult = await simAgentClient.makeRequest('/api/yaml/parse', {
          body: {
            yamlContent: content,
            blockRegistry,
            utilities: {
              generateLoopBlocks: generateLoopBlocks.toString(),
              generateParallelBlocks: generateParallelBlocks.toString(),
              resolveOutputType: resolveOutputType.toString(),
            },
          },
        })

        if (!parseResult.success || !parseResult.data?.data) {
          setImportResult({
            success: false,
            errors: parseResult.data?.errors || [parseResult.error || 'Failed to parse YAML'],
            warnings: [],
          })
          return
        }

        const yamlWorkflow = parseResult.data.data

        // Create a new workflow
        const newWorkflowId = await createWorkflow({
          name: `Imported Workflow - ${new Date().toLocaleString()}`,
          description: 'Workflow imported from YAML',
          workspaceId,
        })

        // Use the new consolidated YAML endpoint to import the workflow
        const response = await fetch(`/api/workflows/${newWorkflowId}/yaml`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            yamlContent: content,
            description: 'Workflow imported from YAML',
            source: 'import',
            applyAutoLayout: true,
            createCheckpoint: false,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          setImportResult({
            success: false,
            errors: [errorData.message || `HTTP ${response.status}: ${response.statusText}`],
            warnings: errorData.warnings || [],
          })
          return
        }

        const result = await response.json()

        // Navigate to the new workflow AFTER import is complete
        if (result.success) {
          logger.info('Navigating to imported workflow')
          router.push(`/workspace/${workspaceId}/w/${newWorkflowId}`)
        }

        setImportResult({
          success: result.success,
          errors: result.errors || [],
          warnings: result.warnings || [],
          summary: result.summary,
        })

        if (result.success) {
          setYamlContent('')
          logger.info('YAML import completed successfully')
        }
      } catch (error) {
        logger.error('Failed to import YAML workflow:', error)
        setImportResult({
          success: false,
          errors: [`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
          warnings: [],
        })
      } finally {
        setIsImporting(false)
      }
    }

    return (
      <>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type='file'
          accept='.yaml,.yml'
          onChange={handleFileUpload}
          className='hidden'
        />
      </>
    )
  }
)

ImportControls.displayName = 'ImportControls'
