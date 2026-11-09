'use client'

import { useMemo, useState } from 'react'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { toast } from '@/lib/toast/sink'
import { CustomToolCodeField } from '@/app/(product)/workspace/[workspaceId]/_components/custom-tool-editor/custom-tool-code-field'
import {
  CUSTOM_TOOL_DELETE_DESCRIPTION,
  CustomToolError,
  CustomToolSchemaField,
} from '@/app/(product)/workspace/[workspaceId]/_components/custom-tool-editor/custom-tool-editor'
import { GeneratePrompt } from '@/app/(product)/workspace/[workspaceId]/_components/generate-prompt/generate-prompt'
import { TagDropdown } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/tag-dropdown/tag-dropdown'
import { useWorkflowScope } from '@/platform/lib/data/workflow-editor'
import {
  type CustomToolDefinition,
  extractSchemaParameters,
  FUNCTION_NAME_LOCKED,
  toolInputLogger,
  useCodeGeneration,
  useCreateCustomTool,
  useCustomTools,
  useDeleteCustomTool,
  useSchemaGeneration,
  useUpdateCustomTool,
  validateCustomToolSchema,
} from '@/platform/lib/data/workflow-editor/tool-input'

type ToolSection = 'schema' | 'code'

/** A custom tool the modal saved, as the tool input stores it. */
export interface SavedCustomTool {
  id?: string
  title: string
  schema: CustomToolDefinition['schema']
  code: string
}

interface CustomToolModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (tool: SavedCustomTool) => void
  onDelete?: (toolId: string) => void
  blockId: string
  /** The tool being edited; absent when creating one. */
  initialValues?: {
    id?: string
    schema: unknown
    code: string
  }
}

/** The function name a stored schema declares, if any. */
function schemaFunctionName(schema: unknown): string | undefined {
  if (!isRecordLike(schema) || !isRecordLike(schema.function)) return undefined
  return typeof schema.function.name === 'string' ? schema.function.name : undefined
}

/**
 * Creates or edits a workspace custom tool: its OpenAI function schema, then its JavaScript body,
 * each with its own AI generation. Unsaved edits ask before they are discarded, and deleting asks
 * to confirm.
 */
export function CustomToolModal({
  open,
  onOpenChange,
  onSave,
  onDelete,
  blockId,
  initialValues,
}: CustomToolModalProps) {
  const { workspaceId } = useWorkflowScope()
  const [section, setSection] = useState<ToolSection>('schema')
  const [jsonSchema, setJsonSchema] = useState('')
  const [functionCode, setFunctionCode] = useState('')
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [toolId, setToolId] = useState<string | undefined>(undefined)
  const [initialJsonSchema, setInitialJsonSchema] = useState('')
  const [initialFunctionCode, setInitialFunctionCode] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  const [wasOpen, setWasOpen] = useState(false)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      const schemaValue = initialValues
        ? typeof initialValues.schema === 'string'
          ? initialValues.schema
          : JSON.stringify(initialValues.schema, null, 2)
        : ''
      const codeValue = initialValues?.code || ''
      setJsonSchema(schemaValue)
      setFunctionCode(codeValue)
      setInitialJsonSchema(schemaValue)
      setInitialFunctionCode(codeValue)
      setSchemaError(null)
      setCodeError(null)
      setSection('schema')
      setIsEditing(Boolean(initialValues))
      setToolId(initialValues?.id)
      setConfirmingDiscard(false)
      setConfirmingDelete(false)
    }
  }

  const schemaParameters = useMemo(() => extractSchemaParameters(jsonSchema), [jsonSchema])

  const schemaGeneration = useSchemaGeneration({
    workspaceId,
    jsonSchema,
    setJsonSchema: (updater) => {
      setJsonSchema(updater)
      setSchemaError(null)
    },
    replaceJsonSchema: (value) => {
      setJsonSchema(value)
      setSchemaError(null)
    },
  })

  const codeGeneration = useCodeGeneration({
    workspaceId,
    functionCode,
    schemaParameters,
    setFunctionCode: (updater) => {
      setFunctionCode(updater)
      setCodeError(null)
    },
    replaceFunctionCode: (value) => {
      setFunctionCode(value)
      setCodeError(null)
    },
  })

  const createToolMutation = useCreateCustomTool()
  const updateToolMutation = useUpdateCustomTool()
  const deleteToolMutation = useDeleteCustomTool()
  const { data: customTools = [] } = useCustomTools(workspaceId)

  const activeGeneration = section === 'schema' ? schemaGeneration : codeGeneration
  const activeError =
    section === 'schema' ? schemaError : codeGeneration.isStreaming ? null : codeError
  const isSchemaValid = useMemo(() => validateCustomToolSchema(jsonSchema).isValid, [jsonSchema])
  const edited = jsonSchema !== initialJsonSchema || functionCode !== initialFunctionCode
  const canSave = !isEditing || edited
  const hasUnsavedChanges = isEditing
    ? edited
    : jsonSchema.trim().length > 0 || functionCode.trim().length > 0
  const streaming = schemaGeneration.isStreaming || codeGeneration.isStreaming

  const handleClose = () => {
    if (schemaGeneration.isStreaming) schemaGeneration.cancelGeneration()
    if (codeGeneration.isStreaming) codeGeneration.cancelGeneration()
    setConfirmingDiscard(false)
    onOpenChange(false)
  }

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges && !streaming) setConfirmingDiscard(true)
    else handleClose()
  }

  const handleJsonSchemaChange = (next: string) => {
    setJsonSchema(next)
    setSchemaError(next.trim() ? validateCustomToolSchema(next).error : null)
  }

  const handleFunctionCodeChange = (next: string) => {
    setFunctionCode(next)
    if (codeError) setCodeError(null)
  }

  const showSchemaError = (message: string) => {
    setSchemaError(message)
    setSection('schema')
  }

  const handleSave = async (): Promise<false> => {
    if (!jsonSchema) {
      showSchemaError('Schema cannot be empty')
      return false
    }
    const { isValid, error } = validateCustomToolSchema(jsonSchema)
    if (!isValid) {
      showSchemaError(error ?? 'Invalid JSON format')
      return false
    }
    setSchemaError(null)
    setCodeError(null)

    try {
      const schema: CustomToolDefinition['schema'] = JSON.parse(jsonSchema)
      const name = schema.function.name

      let toolIdToUpdate = toolId
      if (isEditing && !toolIdToUpdate) {
        const originalName = schemaFunctionName(initialValues?.schema)
        if (originalName) {
          toolIdToUpdate = customTools.find(
            (tool) => tool.schema?.function?.name === originalName
          )?.id
        }
      }

      let savedToolId: string | undefined
      if (isEditing && toolIdToUpdate) {
        await updateToolMutation.mutateAsync({
          workspaceId,
          toolId: toolIdToUpdate,
          updates: { title: name, schema, code: functionCode || '' },
        })
        savedToolId = toolIdToUpdate
      } else {
        const result = await createToolMutation.mutateAsync({
          workspaceId,
          tool: { title: name, schema, code: functionCode || '' },
        })
        savedToolId = result?.[0]?.id
      }

      onSave({ id: savedToolId, title: name, schema, code: functionCode || '' })
      handleClose()
    } catch (error) {
      toolInputLogger.error('Error saving custom tool', { error })
      const message = getErrorMessage(error, 'Failed to save custom tool')
      showSchemaError(
        message.includes('Cannot change function name') ? FUNCTION_NAME_LOCKED : message
      )
    }
    return false
  }

  const handleDelete = async () => {
    if (!toolId || !isEditing) return
    try {
      await deleteToolMutation.mutateAsync({ workspaceId, toolId })
      toolInputLogger.info('Deleted custom tool', { toolId })
      onDelete?.(toolId)
      setConfirmingDelete(false)
      handleClose()
    } catch (error) {
      toolInputLogger.error('Error deleting custom tool', { error })
      toast.error("Couldn't delete tool", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  const title = isEditing ? 'Edit Agent Tool' : 'Create Agent Tool'

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) handleCloseAttempt()
        }}
        title={title}
        confirmLabel={section === 'schema' ? 'Next' : isEditing ? 'Update Tool' : 'Save Tool'}
        confirmDisabled={!isSchemaValid || Boolean(schemaError) || (section === 'code' && !canSave)}
        onConfirm={
          section === 'schema'
            ? () => {
                setSection('code')
                return false
              }
            : handleSave
        }
        onBack={section === 'code' ? () => setSection('schema') : undefined}
        footerStartAction={
          isEditing && toolId
            ? {
                label: 'Delete',
                variant: 'quiet',
                destructive: true,
                onClick: () => setConfirmingDelete(true),
              }
            : undefined
        }
        submitOnEnter={false}
      >
        <ContentTabs
          label='Tool definition'
          current={section}
          onSelect={(next) => setSection(next === 'code' ? 'code' : 'schema')}
          actions={
            <>
              {activeError && <CustomToolError message={activeError} />}
              <GeneratePrompt
                key={section}
                isLoading={activeGeneration.isLoading}
                isStreaming={activeGeneration.isStreaming}
                onSubmit={(prompt) => activeGeneration.generateStream({ prompt })}
              />
            </>
          }
          items={[
            {
              id: 'schema',
              label: 'Schema',
              content: (
                <CustomToolSchemaField
                  value={jsonSchema}
                  onChange={handleJsonSchemaChange}
                  isLoading={schemaGeneration.isLoading}
                  isStreaming={schemaGeneration.isStreaming}
                  invalid={Boolean(schemaError)}
                />
              ),
            },
            {
              id: 'code',
              label: 'Code',
              content: (
                <CustomToolCodeField
                  value={functionCode}
                  onChange={handleFunctionCodeChange}
                  isLoading={codeGeneration.isLoading}
                  isStreaming={codeGeneration.isStreaming}
                  schemaParameters={schemaParameters}
                  workspaceId={workspaceId}
                  renderReferencePicker={(picker) => (
                    <TagDropdown
                      visible={picker.visible}
                      onSelect={picker.onSelect}
                      blockId={blockId}
                      activeSourceBlockId={null}
                      inputValue={picker.inputValue}
                      cursorPosition={picker.cursorPosition}
                      onClose={picker.onClose}
                      inputRef={picker.inputRef}
                    />
                  )}
                />
              ),
            },
          ]}
        />
      </Modal>

      <ConfirmDialog
        target={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title='Delete Custom Tool'
        description={CUSTOM_TOOL_DELETE_DESCRIPTION}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        pending={deleteToolMutation.isPending}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        target={confirmingDiscard}
        onClose={() => setConfirmingDiscard(false)}
        title='Unsaved Changes'
        description='You have unsaved changes. Are you sure you want to discard them?'
        confirmLabel='Discard Changes'
        pendingLabel='Discarding…'
        onConfirm={handleClose}
      />
    </>
  )
}
