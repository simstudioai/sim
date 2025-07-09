'use client'

import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle, FileText, Plus, Upload } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { importWorkflowFromYaml, parseWorkflowYaml } from '@/stores/workflows/yaml/importer'

const logger = createLogger('ImportControls')

interface ImportControlsProps {
  disabled?: boolean
}

export function ImportControls({ disabled = false }: ImportControlsProps) {
  const [isImporting, setIsImporting] = useState(false)
  const [showYamlDialog, setShowYamlDialog] = useState(false)
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
  const subBlockStore = useSubBlockStore()

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      setYamlContent(content)
      setShowYamlDialog(true)
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

  const handleYamlImport = async () => {
    if (!yamlContent.trim()) {
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
      const { data: yamlWorkflow, errors: parseErrors } = parseWorkflowYaml(yamlContent)

      if (!yamlWorkflow || parseErrors.length > 0) {
        setImportResult({
          success: false,
          errors: parseErrors,
          warnings: [],
        })
        return
      }

      // Create a new workflow
      logger.info('Creating new workflow for YAML import')
      const newWorkflowId = await createWorkflow({
        name: `Imported Workflow - ${new Date().toLocaleString()}`,
        description: 'Workflow imported from YAML',
        workspaceId,
      })

      // Import the YAML into the new workflow BEFORE navigation (creates complete state and saves directly to DB)
      // This avoids timing issues with workflow reload during navigation
      logger.info('Importing YAML into new workflow before navigation')
      const result = await importWorkflowFromYaml(
        yamlContent,
        {
          addBlock: collaborativeAddBlock,
          addEdge: collaborativeAddEdge,
          applyAutoLayout: () => {
            // Trigger auto layout
            window.dispatchEvent(new CustomEvent('trigger-auto-layout'))
          },
          setSubBlockValue: (blockId: string, subBlockId: string, value: any) => {
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
        setShowYamlDialog(false)
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

  const handleOpenYamlDialog = () => {
    setYamlContent('')
    setImportResult(null)
    setShowYamlDialog(true)
  }

  const isDisabled = disabled || isImporting

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {isDisabled ? (
                <div className='inline-flex h-10 w-10 cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm opacity-50 ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'>
                  <Plus className='h-4 w-4' />
                </div>
              ) : (
                <Button
                  variant='ghost'
                  size='icon'
                  className='hover:text-primary'
                  disabled={isDisabled}
                >
                  <Plus className='h-4 w-4' />
                  <span className='sr-only'>Import Workflow</span>
                </Button>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-64'>
              <DropdownMenuItem
                onClick={() => fileInputRef.current?.click()}
                disabled={isDisabled}
                className='flex cursor-pointer items-center gap-2'
              >
                <Upload className='h-4 w-4' />
                <div className='flex flex-col'>
                  <span>Upload YAML File</span>
                  <span className='text-muted-foreground text-xs'>
                    Import from .yaml or .yml file
                  </span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={handleOpenYamlDialog}
                disabled={isDisabled}
                className='flex cursor-pointer items-center gap-2'
              >
                <FileText className='h-4 w-4' />
                <div className='flex flex-col'>
                  <span>Paste YAML</span>
                  <span className='text-muted-foreground text-xs'>Import from YAML text</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipTrigger>
        <TooltipContent>
          {isDisabled
            ? isImporting
              ? 'Importing workflow...'
              : 'Cannot import workflow'
            : 'Import Workflow from YAML'}
        </TooltipContent>
      </Tooltip>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type='file'
        accept='.yaml,.yml'
        onChange={handleFileUpload}
        className='hidden'
      />

      {/* YAML Import Dialog */}
      <Dialog open={showYamlDialog} onOpenChange={setShowYamlDialog}>
        <DialogContent className='flex max-h-[80vh] max-w-4xl flex-col'>
          <DialogHeader>
            <DialogTitle>Import Workflow from YAML</DialogTitle>
            <DialogDescription>
              Paste your workflow YAML content below. This will create a new workflow with the
              blocks and connections defined in the YAML.
            </DialogDescription>
          </DialogHeader>

          <div className='flex-1 space-y-4 overflow-hidden'>
            <Textarea
              placeholder={`version: "1.0"
blocks:
  start:
    type: "starter"
    name: "Start"
    inputs:
      startWorkflow: "manual"
    following:
      - "process"
  
  process:
    type: "agent"
    name: "Process Data"
    inputs:
      systemPrompt: "You are a helpful assistant"
      userPrompt: "Process the data"
      model: "gpt-4"
    preceding:
      - "start"`}
              value={yamlContent}
              onChange={(e) => setYamlContent(e.target.value)}
              className='min-h-[300px] font-mono text-sm'
              disabled={isImporting}
            />

            {/* Import Result */}
            {importResult && (
              <div className='space-y-2'>
                {importResult.success ? (
                  <Alert>
                    <CheckCircle className='h-4 w-4' />
                    <AlertDescription>
                      <div className='font-medium text-green-700'>Import Successful!</div>
                      {importResult.summary && (
                        <div className='mt-1 text-sm'>{importResult.summary}</div>
                      )}
                      {importResult.warnings.length > 0 && (
                        <div className='mt-2'>
                          <div className='font-medium text-sm'>Warnings:</div>
                          <ul className='mt-1 space-y-1 text-sm'>
                            {importResult.warnings.map((warning, index) => (
                              <li key={index} className='text-yellow-700'>
                                • {warning}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant='destructive'>
                    <AlertCircle className='h-4 w-4' />
                    <AlertDescription>
                      <div className='font-medium'>Import Failed</div>
                      {importResult.errors.length > 0 && (
                        <ul className='mt-2 space-y-1 text-sm'>
                          {importResult.errors.map((error, index) => (
                            <li key={index}>• {error}</li>
                          ))}
                        </ul>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setShowYamlDialog(false)}
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button onClick={handleYamlImport} disabled={isImporting || !yamlContent.trim()}>
              {isImporting ? 'Importing...' : 'Import Workflow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
