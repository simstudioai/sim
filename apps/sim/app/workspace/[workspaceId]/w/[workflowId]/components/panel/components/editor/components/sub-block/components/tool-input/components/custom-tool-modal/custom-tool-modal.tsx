'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalFooter,
  ChipModalHeader,
  ChipModalTabs,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import {
  CUSTOM_TOOL_DELETE_CONFIRM_TEXT,
  CustomToolCodeField,
  CustomToolSchemaField,
  extractSchemaParameters,
  FieldErrorText,
  FUNCTION_NAME_LOCKED,
  GeneratePromptControl,
  useCodeGeneration,
  useSchemaGeneration,
  validateCustomToolSchema,
} from '@/app/workspace/[workspaceId]/components/custom-tool-editor'
import {
  useCreateCustomTool,
  useCustomTools,
  useDeleteCustomTool,
  useUpdateCustomTool,
} from '@/hooks/queries/custom-tools'

const logger = createLogger('CustomToolModal')

interface CustomToolModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (tool: CustomTool) => void
  onDelete?: (toolId: string) => void
  blockId: string
  initialValues?: {
    id?: string
    schema: any
    code: string
  }
}

export interface CustomTool {
  type: 'custom-tool'
  id?: string
  title: string
  name: string
  description: string
  schema: any
  code: string
  params: Record<string, string>
  isExpanded?: boolean
}

type ToolSection = 'schema' | 'code'

const TOOL_TABS = [
  { value: 'schema', label: 'Schema' },
  { value: 'code', label: 'Code' },
] as const

export function CustomToolModal({
  open,
  onOpenChange,
  onSave,
  onDelete,
  blockId,
  initialValues,
}: CustomToolModalProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [activeSection, setActiveSection] = useState<ToolSection>('schema')
  const [jsonSchema, setJsonSchema] = useState('')
  const [functionCode, setFunctionCode] = useState('')
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [toolId, setToolId] = useState<string | undefined>(undefined)
  const [initialJsonSchema, setInitialJsonSchema] = useState('')
  const [initialFunctionCode, setInitialFunctionCode] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDiscardAlert, setShowDiscardAlert] = useState(false)

  const schemaParameters = useMemo(() => extractSchemaParameters(jsonSchema), [jsonSchema])

  const schemaGeneration = useSchemaGeneration({
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

  useEffect(() => {
    if (!open) return

    if (initialValues) {
      try {
        const schemaValue =
          typeof initialValues.schema === 'string'
            ? initialValues.schema
            : JSON.stringify(initialValues.schema, null, 2)
        const codeValue = initialValues.code || ''
        setJsonSchema(schemaValue)
        setFunctionCode(codeValue)
        setInitialJsonSchema(schemaValue)
        setInitialFunctionCode(codeValue)
        setIsEditing(true)
        setToolId(initialValues.id)
      } catch (error) {
        logger.error('Error initializing form with initial values:', { error })
        setSchemaError('Failed to load tool data. Please try again.')
      }
    } else {
      resetForm()
    }
  }, [open])

  const resetForm = () => {
    setJsonSchema('')
    setFunctionCode('')
    setInitialJsonSchema('')
    setInitialFunctionCode('')
    setSchemaError(null)
    setCodeError(null)
    setActiveSection('schema')
    setIsEditing(false)
    setToolId(undefined)
    setShowDiscardAlert(false)
  }

  const handleClose = () => {
    if (schemaGeneration.isStreaming) schemaGeneration.cancelGeneration()
    if (codeGeneration.isStreaming) codeGeneration.cancelGeneration()
    resetForm()
    onOpenChange(false)
  }

  /** The Generate control and error live in the shared tab row, so both follow the visible editor. */
  const activeGeneration = activeSection === 'schema' ? schemaGeneration : codeGeneration
  const activeError =
    activeSection === 'schema' ? schemaError : codeGeneration.isStreaming ? null : codeError

  const isSchemaValid = useMemo(() => validateCustomToolSchema(jsonSchema).isValid, [jsonSchema])

  const edited = jsonSchema !== initialJsonSchema || functionCode !== initialFunctionCode
  const canSave = !isEditing || edited
  const hasUnsavedChanges = isEditing
    ? edited
    : jsonSchema.trim().length > 0 || functionCode.trim().length > 0

  const handleCloseAttempt = () => {
    if (hasUnsavedChanges && !schemaGeneration.isStreaming && !codeGeneration.isStreaming) {
      setShowDiscardAlert(true)
    } else {
      handleClose()
    }
  }

  const handleConfirmDiscard = () => {
    setShowDiscardAlert(false)
    handleClose()
  }

  const handleSave = async () => {
    try {
      if (!jsonSchema) {
        setSchemaError('Schema cannot be empty')
        setActiveSection('schema')
        return
      }

      const { isValid, error } = validateCustomToolSchema(jsonSchema)
      if (!isValid) {
        setSchemaError(error)
        setActiveSection('schema')
        return
      }

      setSchemaError(null)
      setCodeError(null)

      const schema = JSON.parse(jsonSchema)
      const name = schema.function.name
      const description = schema.function.description || ''

      let toolIdToUpdate: string | undefined = toolId
      if (isEditing && !toolIdToUpdate && initialValues?.schema) {
        const originalName = initialValues.schema.function?.name
        if (originalName) {
          const originalTool = customTools.find(
            (tool) => tool.schema?.function?.name === originalName
          )
          if (originalTool) {
            toolIdToUpdate = originalTool.id
          }
        }
      }

      let savedToolId: string | undefined

      if (isEditing && toolIdToUpdate) {
        await updateToolMutation.mutateAsync({
          workspaceId,
          toolId: toolIdToUpdate,
          updates: {
            title: name,
            schema,
            code: functionCode || '',
          },
        })
        savedToolId = toolIdToUpdate
      } else {
        const result = await createToolMutation.mutateAsync({
          workspaceId,
          tool: {
            title: name,
            schema,
            code: functionCode || '',
          },
        })
        savedToolId = result?.[0]?.id
      }

      const customTool: CustomTool = {
        type: 'custom-tool',
        id: savedToolId,
        title: name,
        name,
        description,
        schema,
        code: functionCode || '',
        params: {},
        isExpanded: true,
      }

      onSave(customTool)
      handleClose()
    } catch (error) {
      logger.error('Error saving custom tool:', { error })
      const errorMessage = getErrorMessage(error, 'Failed to save custom tool')

      if (errorMessage.includes('Cannot change function name')) {
        setSchemaError(FUNCTION_NAME_LOCKED)
      } else {
        setSchemaError(errorMessage)
      }
      setActiveSection('schema')
    }
  }

  const handleJsonSchemaChange = (value: string) => {
    setJsonSchema(value)

    if (value.trim()) {
      const { error } = validateCustomToolSchema(value)
      setSchemaError(error)
    } else {
      setSchemaError(null)
    }
  }

  const handleFunctionCodeChange = (value: string) => {
    setFunctionCode(value)
    if (codeError) setCodeError(null)
  }

  const handleDelete = async () => {
    if (!toolId || !isEditing) return

    try {
      setShowDeleteConfirm(false)

      await deleteToolMutation.mutateAsync({
        workspaceId,
        toolId,
      })
      logger.info(`Deleted tool: ${toolId}`)

      onDelete?.(toolId)

      handleClose()
    } catch (error) {
      logger.error('Error deleting custom tool:', error)
      // A delete failure is not a schema problem — keep it out of the Schema slot.
      toast.error("Couldn't delete tool", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
      setShowDeleteConfirm(false)
    }
  }

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={handleCloseAttempt}
        srTitle={isEditing ? 'Edit Agent Tool' : 'Create Agent Tool'}
        size='xl'
      >
        <ChipModalHeader onClose={handleCloseAttempt}>
          {isEditing ? 'Edit Agent Tool' : 'Create Agent Tool'}
        </ChipModalHeader>

        {/*
          The body is the scroll region so tall schema/code content stays inside
          the modal and the footer (Next/Save) is always reachable. The EnvVar,
          Tag, and schema-param autocompletes render their menus in portaled
          popovers (never clipped by this scroll boundary) and anchor to a
          caret-positioned element inside the editor wrapper, so the menus track
          the caret as the body scrolls.
        */}
        <ChipModalBody className='gap-2 px-4'>
          <div className='flex min-h-6 items-center justify-between gap-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <ChipModalTabs
                tabs={TOOL_TABS}
                value={activeSection}
                onChange={(value) => setActiveSection(value as ToolSection)}
              />
              {activeError && <FieldErrorText>{activeError}</FieldErrorText>}
            </div>
            {/*
              Keyed by section so switching tabs resets the inline prompt — one
              control drives both wands, and a half-typed Schema prompt must not
              carry over and generate Code instead.
            */}
            <GeneratePromptControl
              key={activeSection}
              isLoading={activeGeneration.isLoading}
              isStreaming={activeGeneration.isStreaming}
              onSubmit={(prompt) => activeGeneration.generateStream({ prompt })}
            />
          </div>

          {activeSection === 'schema' && (
            <CustomToolSchemaField
              value={jsonSchema}
              onChange={handleJsonSchemaChange}
              error={!!schemaError}
              generation={schemaGeneration}
            />
          )}

          {activeSection === 'code' && (
            <CustomToolCodeField
              value={functionCode}
              onChange={handleFunctionCodeChange}
              error={!!codeError}
              generation={codeGeneration}
              schemaParameters={schemaParameters}
              workspaceId={workspaceId}
              blockId={blockId}
            />
          )}
        </ChipModalBody>

        {activeSection === 'schema' && (
          <ChipModalFooter
            onCancel={handleClose}
            secondaryActions={
              isEditing
                ? [
                    {
                      label: 'Delete',
                      onClick: () => setShowDeleteConfirm(true),
                      variant: 'destructive',
                    },
                  ]
                : undefined
            }
            primaryAction={{
              label: 'Next',
              onClick: () => setActiveSection('code'),
              disabled: !isSchemaValid || !!schemaError,
            }}
          />
        )}

        {activeSection === 'code' && (
          <ChipModalFooter
            onCancel={handleClose}
            secondaryActions={[
              isEditing
                ? {
                    label: 'Delete',
                    onClick: () => setShowDeleteConfirm(true),
                    variant: 'destructive',
                  }
                : { label: 'Back', onClick: () => setActiveSection('schema') },
            ]}
            primaryAction={{
              label: isEditing ? 'Update Tool' : 'Save Tool',
              onClick: handleSave,
              disabled: !isSchemaValid || !!schemaError || !canSave,
            }}
          />
        )}
      </ChipModal>

      <ChipConfirmModal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        srTitle='Delete Custom Tool'
        title='Delete Custom Tool'
        text={CUSTOM_TOOL_DELETE_CONFIRM_TEXT}
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          pending: deleteToolMutation.isPending,
          pendingLabel: 'Deleting...',
        }}
      />

      <ChipConfirmModal
        open={showDiscardAlert}
        onOpenChange={setShowDiscardAlert}
        srTitle='Unsaved Changes'
        title='Unsaved Changes'
        text='You have unsaved changes. Are you sure you want to discard them?'
        dismissLabel='Keep editing'
        confirm={{
          label: 'Discard Changes',
          onClick: handleConfirmDiscard,
        }}
      />
    </>
  )
}
