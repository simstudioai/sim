'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, FileCode, Save } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { CodeEditor } from '../panel-new/components/editor/components/sub-block/components/tool-input/components/code-editor/code-editor'

const logger = createLogger('WorkflowTextEditor')

export type EditorFormat = 'json'

interface ValidationError {
  line?: number
  column?: number
  message: string
}

interface WorkflowTextEditorProps {
  initialValue: string
  onSave: (content: string) => Promise<{ success: boolean; errors?: string[]; warnings?: string[] }>
  className?: string
  disabled?: boolean
}

export function WorkflowTextEditor({
  initialValue,
  onSave,
  className,
  disabled = false,
}: WorkflowTextEditorProps) {
  const [content, setContent] = useState(initialValue)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{
    success: boolean
    errors?: string[]
    warnings?: string[]
  } | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Validate JSON syntax
  const validateSyntax = useCallback((text: string): ValidationError[] => {
    const errors: ValidationError[] = []

    if (!text.trim()) {
      return errors
    }

    try {
      JSON.parse(text)
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Parse error'

      const lineMatch = errorMessage.match(/line (\d+)/i)
      const columnMatch = errorMessage.match(/column (\d+)/i)

      errors.push({
        line: lineMatch ? Number.parseInt(lineMatch[1], 10) : undefined,
        column: columnMatch ? Number.parseInt(columnMatch[1], 10) : undefined,
        message: errorMessage,
      })
    }

    return errors
  }, [])

  // Handle content changes
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      setHasUnsavedChanges(newContent !== initialValue)

      // Validate on change
      const errors = validateSyntax(newContent)
      setValidationErrors(errors)

      // Clear save result when editing
      setSaveResult(null)
    },
    [initialValue, validateSyntax]
  )

  // Handle save
  const handleSave = useCallback(async () => {
    if (validationErrors.length > 0) {
      logger.warn('Cannot save with validation errors')
      return
    }

    setIsSaving(true)
    setSaveResult(null)

    try {
      const result = await onSave(content)
      setSaveResult(result)

      if (result.success) {
        setHasUnsavedChanges(false)
        logger.info('Workflow successfully updated from text editor')
      } else {
        logger.error('Failed to save workflow:', result.errors)
      }
    } catch (error) {
      logger.error('Save failed with exception:', error)
      setSaveResult({
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      })
    } finally {
      setIsSaving(false)
    }
  }, [content, validationErrors, onSave])

  // Update content when initialValue changes
  useEffect(() => {
    setContent(initialValue)
    setHasUnsavedChanges(false)
    setSaveResult(null)
  }, [initialValue])

  // Validation status
  const isValid = validationErrors.length === 0
  const canSave = isValid && hasUnsavedChanges && !disabled

  return (
    <div className={cn('flex h-full flex-col bg-background', className)}>
      {/* Header with controls */}
      <div className='flex-shrink-0 border-b bg-background px-6 py-4'>
        <div className='mb-3 flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <FileCode className='h-5 w-5' />
            <span className='font-semibold'>Workflow JSON Editor</span>
          </div>
          <div className='flex items-center gap-2'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  onClick={handleSave}
                  disabled={!canSave || isSaving}
                  size='sm'
                  className='flex items-center gap-2'
                >
                  <Save className='h-4 w-4' />
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                {!isValid
                  ? 'Fix validation errors to save'
                  : !hasUnsavedChanges
                    ? 'No changes to save'
                    : disabled
                      ? 'Editor is disabled'
                      : 'Save changes to workflow'}
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
        </div>

        {/* Status indicators */}
        <div className='flex items-center gap-2 text-sm'>
          {isValid ? (
            <div className='flex items-center gap-1 text-green-600'>
              <Check className='h-4 w-4' />
              Valid JSON
            </div>
          ) : (
            <div className='flex items-center gap-1 text-red-600'>
              <AlertCircle className='h-4 w-4' />
              {validationErrors.length} validation error{validationErrors.length !== 1 ? 's' : ''}
            </div>
          )}

          {hasUnsavedChanges && <div className='text-orange-600'>• Unsaved changes</div>}
        </div>
      </div>

      {/* Alerts section - fixed height, scrollable if needed */}
      {(validationErrors.length > 0 || saveResult) && (
        <div className='max-h-32 flex-shrink-0 overflow-y-auto border-b bg-muted/20'>
          <div className='space-y-2 p-4'>
            {/* Validation errors */}
            {validationErrors.length > 0 && (
              <>
                {validationErrors.map((error, index) => (
                  <Alert key={index} variant='destructive' className='py-2'>
                    <AlertCircle className='h-4 w-4' />
                    <AlertDescription className='text-sm'>
                      {error.line && error.column
                        ? `Line ${error.line}, Column ${error.column}: ${error.message}`
                        : error.message}
                    </AlertDescription>
                  </Alert>
                ))}
              </>
            )}

            {/* Save result */}
            {saveResult && (
              <Alert variant={saveResult.success ? 'default' : 'destructive'} className='py-2'>
                {saveResult.success ? (
                  <Check className='h-4 w-4' />
                ) : (
                  <AlertCircle className='h-4 w-4' />
                )}
                <AlertDescription className='text-sm'>
                  {saveResult.success ? (
                    <>
                      Workflow updated successfully!
                      {saveResult.warnings && saveResult.warnings.length > 0 && (
                        <div className='mt-2'>
                          <strong>Warnings:</strong>
                          <ul className='mt-1 list-inside list-disc text-xs'>
                            {saveResult.warnings.map((warning, index) => (
                              <li key={index}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      Failed to update workflow:
                      {saveResult.errors && (
                        <ul className='mt-1 list-inside list-disc text-xs'>
                          {saveResult.errors.map((error, index) => (
                            <li key={index}>{error}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      )}

      {/* Code editor - takes remaining space */}
      <div className='min-h-0 flex-1 overflow-hidden'>
        <div className='h-full p-4'>
          <CodeEditor
            value={content}
            onChange={handleContentChange}
            language='json'
            placeholder='Enter JSON workflow definition...'
            className={cn(
              'h-full w-full overflow-auto rounded-md border',
              !isValid && 'border-red-500',
              hasUnsavedChanges && 'border-orange-500'
            )}
            minHeight='calc(100vh - 300px)'
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}
