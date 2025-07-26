'use client'

import { useCallback, useEffect, useState } from 'react'
import { dump as yamlDump, load as yamlParse } from 'js-yaml'
import { AlertCircle, Check, FileCode, Save } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { CodeEditor } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/components/tool-input/components/code-editor/code-editor'

const logger = createLogger('WorkflowTextEditor')

export type EditorFormat = 'yaml' | 'json'

interface ValidationError {
  line?: number
  column?: number
  message: string
}

interface WorkflowTextEditorProps {
  initialValue: string
  format: EditorFormat
  onSave: (
    content: string,
    format: EditorFormat
  ) => Promise<{ success: boolean; errors?: string[]; warnings?: string[] }>
  onFormatChange?: (format: EditorFormat) => void
  className?: string
  disabled?: boolean
}

export function WorkflowTextEditor({
  initialValue,
  format,
  onSave,
  onFormatChange,
  className,
  disabled = false,
}: WorkflowTextEditorProps) {
  const [content, setContent] = useState(initialValue)
  const [currentFormat, setCurrentFormat] = useState<EditorFormat>(format)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{
    success: boolean
    errors?: string[]
    warnings?: string[]
  } | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Validate content based on format
  const validateContent = useCallback((text: string, fmt: EditorFormat): ValidationError[] => {
    const errors: ValidationError[] = []

    if (!text.trim()) {
      return errors // Empty content is valid
    }

    try {
      if (fmt === 'yaml') {
        yamlParse(text)
      } else if (fmt === 'json') {
        JSON.parse(text)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Parse error'

      // Extract line/column info if available
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

  // Convert between formats
  const convertFormat = useCallback(
    (text: string, fromFormat: EditorFormat, toFormat: EditorFormat): string => {
      if (fromFormat === toFormat || !text.trim()) {
        return text
      }

      try {
        let parsed: any

        if (fromFormat === 'yaml') {
          parsed = yamlParse(text)
        } else {
          parsed = JSON.parse(text)
        }

        if (toFormat === 'yaml') {
          return yamlDump(parsed, {
            indent: 2,
            lineWidth: -1,
            noRefs: true,
          })
        }
        return JSON.stringify(parsed, null, 2)
      } catch (error) {
        logger.warn(`Failed to convert from ${fromFormat} to ${toFormat}:`, error)
        return text // Return original if conversion fails
      }
    },
    []
  )

  // Handle content changes
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      setHasUnsavedChanges(newContent !== initialValue)

      // Validate on change
      const errors = validateContent(newContent, currentFormat)
      setValidationErrors(errors)

      // Clear save result when editing
      setSaveResult(null)
    },
    [initialValue, currentFormat, validateContent]
  )

  // Handle format changes
  const handleFormatChange = useCallback(
    (newFormat: EditorFormat) => {
      if (newFormat === currentFormat) return

      // Convert content to new format
      const convertedContent = convertFormat(content, currentFormat, newFormat)

      setCurrentFormat(newFormat)
      setContent(convertedContent)

      // Validate converted content
      const errors = validateContent(convertedContent, newFormat)
      setValidationErrors(errors)

      // Notify parent
      onFormatChange?.(newFormat)
    },
    [content, currentFormat, convertFormat, validateContent, onFormatChange]
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
      const result = await onSave(content, currentFormat)
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
  }, [content, currentFormat, validationErrors, onSave])

  // Update content when initialValue changes
  useEffect(() => {
    setContent(initialValue)
    setHasUnsavedChanges(false)
    setSaveResult(null)
  }, [initialValue])

  // Validation status
  const isValid = validationErrors.length === 0
  const canSave = isValid && hasUnsavedChanges && !disabled

  // Get editor language for syntax highlighting
  const editorLanguage = currentFormat === 'yaml' ? 'javascript' : 'json' // yaml highlighting not available, use js

  return (
    <div className={cn('flex h-full flex-col bg-background', className)}>
      {/* Header with controls */}
      <div className='flex-shrink-0 border-b bg-background px-6 py-4'>
        <div className='mb-3 flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <FileCode className='h-5 w-5' />
            <span className='font-semibold'>Workflow Text Editor</span>
          </div>
          <div className='flex items-center gap-2'>
            <Tabs
              value={currentFormat}
              onValueChange={(value) => handleFormatChange(value as EditorFormat)}
            >
              <TabsList className='grid w-fit grid-cols-2'>
                <TabsTrigger value='yaml' disabled={disabled}>
                  YAML
                </TabsTrigger>
                <TabsTrigger value='json' disabled={disabled}>
                  JSON
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleSave}
                  disabled={!canSave || isSaving}
                  size='sm'
                  className='flex items-center gap-2'
                >
                  <Save className='h-4 w-4' />
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {!isValid
                  ? 'Fix validation errors to save'
                  : !hasUnsavedChanges
                    ? 'No changes to save'
                    : disabled
                      ? 'Editor is disabled'
                      : 'Save changes to workflow'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Status indicators */}
        <div className='flex items-center gap-2 text-sm'>
          {isValid ? (
            <div className='flex items-center gap-1 text-green-600'>
              <Check className='h-4 w-4' />
              Valid {currentFormat.toUpperCase()}
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
        <div className='scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent max-h-32 flex-shrink-0 overflow-y-auto border-b bg-muted/20'>
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
            language={editorLanguage}
            placeholder={`Enter ${currentFormat.toUpperCase()} workflow definition...`}
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
