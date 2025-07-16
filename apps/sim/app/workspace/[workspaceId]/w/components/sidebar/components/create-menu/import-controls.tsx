'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console-logger'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { importWorkflowFromYaml, parseWorkflowYaml } from '@/stores/workflows/yaml/importer'

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
    const { collaborativeAddBlock, collaborativeAddEdge, collaborativeSetSubblockValue } =
      useCollaborativeWorkflow()

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
        const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(content)

        if (!yamlWorkflow || parseErrors.length > 0) {
          setImportResult({
            success: false,
            errors: parseErrors,
            warnings: [],
          })
          return
        }

        // Create a new workflow
        const newWorkflowId = await createWorkflow({
          name: `Imported Workflow - ${new Date().toLocaleString()}`,
          description: 'Workflow imported from YAML',
          workspaceId,
        })

        // Import the YAML into the new workflow BEFORE navigation (creates complete state and saves directly to DB)
        // This avoids timing issues with workflow reload during navigation
        const result = await importWorkflowFromYaml(
          content,
          {
            addBlock: collaborativeAddBlock,
            addEdge: collaborativeAddEdge,
            applyAutoLayout: () => {
              // Do nothing - auto layout should not run during import
            },
            setSubBlockValue: (blockId: string, subBlockId: string, value: unknown) => {
              // Use the collaborative function - the same one called when users type into fields
              collaborativeSetSubblockValue(blockId, subBlockId, value)
            },
            getExistingBlocks: () => {
              // For a new workflow, we'll get the starter block from the server
              return {}
            },
          },
          newWorkflowId
        ) // Pass the new workflow ID to import into

        // Navigate to the new workflow AFTER import is complete
        if (result.success) {
          logger.info('Navigating to imported workflow')
          router.push(`/workspace/${workspaceId}/w/${newWorkflowId}`)
        }

        setImportResult(result)

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
