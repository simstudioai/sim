'use client'

import { useMemo, useState } from 'react'
import { ChipConfirmModal, toast } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { UnsavedChangesModal } from '@/app/workspace/[workspaceId]/components/credential-detail'
import {
  CUSTOM_TOOL_DELETE_CONFIRM_TEXT,
  CustomToolCodeField,
  CustomToolSchemaField,
  extractSchemaIdentity,
  extractSchemaParameters,
  FieldErrorText,
  FUNCTION_NAME_LOCKED,
  GeneratePromptControl,
  useCodeGeneration,
  useSchemaGeneration,
  validateCustomToolSchema,
} from '@/app/workspace/[workspaceId]/components/custom-tool-editor'
import { saveDiscardActions } from '@/app/workspace/[workspaceId]/settings/components/save-discard-actions/save-discard-actions'
import type { SettingsAction } from '@/app/workspace/[workspaceId]/settings/components/settings-header/settings-header'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useSettingsUnsavedGuard } from '@/app/workspace/[workspaceId]/settings/hooks/use-settings-unsaved-guard'
import type { CustomToolDefinition } from '@/hooks/queries/custom-tools'
import {
  useCreateCustomTool,
  useDeleteCustomTool,
  useUpdateCustomTool,
} from '@/hooks/queries/custom-tools'

const logger = createLogger('CustomToolDetail')

interface CustomToolDetailProps {
  workspaceId: string
  /** `null` on the create flow, which starts from an empty draft. */
  tool: CustomToolDefinition | null
  onBack: () => void
}

/**
 * Full-page custom tool editor rendered as a settings detail sub-view: a back
 * chip, dirty-gated Discard/Save, Delete, and the Schema and Code editors
 * stacked (no tabs — the page has room for both). Uses the same fields as the
 * canvas modal so the two surfaces never drift.
 */
export function CustomToolDetail({ workspaceId, tool, onBack }: CustomToolDetailProps) {
  const isEditing = !!tool

  const createTool = useCreateCustomTool()
  const updateTool = useUpdateCustomTool()
  const deleteTool = useDeleteCustomTool()

  /**
   * The dirty baseline. Seeded once at mount — the list keys this view by tool
   * id, so picking a different tool remounts it — and moved only by an explicit
   * save. A background list refetch must never shift it out from under
   * in-progress edits.
   */
  const [seededSchema, setSeededSchema] = useState(() =>
    tool ? JSON.stringify(tool.schema, null, 2) : ''
  )
  const [seededCode, setSeededCode] = useState(() => tool?.code ?? '')

  const [jsonSchema, setJsonSchema] = useState(seededSchema)
  const [functionCode, setFunctionCode] = useState(seededCode)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const schemaParameters = useMemo(() => extractSchemaParameters(jsonSchema), [jsonSchema])

  /**
   * Heading reflects the draft schema, so the tool names itself as you type
   * rather than hiding its identity inside the JSON. Falls back to the saved
   * tool while the draft is mid-edit and unparseable.
   */
  const identity = useMemo(() => extractSchemaIdentity(jsonSchema), [jsonSchema])

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

  const dirty = isEditing
    ? jsonSchema !== seededSchema || functionCode !== seededCode
    : jsonSchema.trim().length > 0 || functionCode.trim().length > 0

  const guard = useSettingsUnsavedGuard({ isDirty: dirty })

  const saving = createTool.isPending || updateTool.isPending
  const isSchemaValid = useMemo(() => validateCustomToolSchema(jsonSchema).isValid, [jsonSchema])
  const streaming = schemaGeneration.isStreaming || codeGeneration.isStreaming

  const handleDiscard = () => {
    setJsonSchema(seededSchema)
    setFunctionCode(seededCode)
    setSchemaError(null)
    setCodeError(null)
  }

  const handleSave = async () => {
    if (saving) return

    if (!jsonSchema.trim()) {
      setSchemaError('Schema cannot be empty')
      return
    }

    const { isValid, error } = validateCustomToolSchema(jsonSchema)
    if (!isValid) {
      setSchemaError(error)
      return
    }

    setSchemaError(null)
    setCodeError(null)

    const schema = JSON.parse(jsonSchema)
    const title = schema.function.name

    try {
      if (tool) {
        await updateTool.mutateAsync({
          workspaceId,
          toolId: tool.id,
          updates: { title, schema, code: functionCode },
        })
        // Saving an edit keeps you on the tool (matching the other settings
        // detail views); re-baseline so Discard/Save drop back out of the header.
        setSeededSchema(jsonSchema)
        setSeededCode(functionCode)
      } else {
        await createTool.mutateAsync({
          workspaceId,
          tool: { title, schema, code: functionCode },
        })
        onBack()
      }
    } catch (error) {
      logger.error('Failed to save custom tool', error)
      const message = getErrorMessage(error, 'Failed to save custom tool')
      setSchemaError(
        message.includes('Cannot change function name') ? FUNCTION_NAME_LOCKED : message
      )
    }
  }

  const handleConfirmDelete = async () => {
    if (!tool) return
    setShowDeleteConfirm(false)
    try {
      await deleteTool.mutateAsync({ workspaceId, toolId: tool.id })
      onBack()
    } catch (error) {
      logger.error('Failed to delete custom tool', error)
      toast.error("Couldn't delete tool", {
        description: getErrorMessage(error, 'Please try again in a moment.'),
      })
    }
  }

  /**
   * On create, the primary action is always visible so the page announces what
   * it is for — disabled until the schema is a valid function definition.
   * (`saveDiscardActions` is dirty-gated and would render nothing on an empty
   * draft.) Discard still only appears once there is something to discard.
   */
  const createToolActions: SettingsAction[] = [
    ...(dirty ? [{ text: 'Discard', onSelect: handleDiscard, disabled: saving }] : []),
    {
      text: saving ? 'Creating...' : 'Create',
      variant: 'primary' as const,
      onSelect: handleSave,
      disabled: saving || streaming || !isSchemaValid,
    },
  ]

  return (
    <>
      <SettingsPanel
        back={{ text: 'Custom tools', icon: ArrowLeft, onSelect: () => guard.guardBack(onBack) }}
        title={identity.name || tool?.title || 'New tool'}
        description={
          identity.description ||
          tool?.schema.function.description ||
          'Define the JSON schema your agents call, and the code that runs.'
        }
        actions={[
          ...(isEditing
            ? saveDiscardActions({
                dirty,
                saving,
                onSave: handleSave,
                onDiscard: handleDiscard,
                saveDisabled: !isSchemaValid || streaming,
              })
            : createToolActions),
          ...(tool
            ? [
                {
                  text: deleteTool.isPending ? 'Deleting...' : 'Delete',
                  variant: 'destructive' as const,
                  onSelect: () => setShowDeleteConfirm(true),
                  disabled: deleteTool.isPending,
                },
              ]
            : []),
        ]}
      >
        <div className='flex flex-col gap-7'>
          <SettingsSection
            label='Schema'
            headerAccessory={
              schemaError ? <FieldErrorText>{schemaError}</FieldErrorText> : undefined
            }
            action={
              <GeneratePromptControl
                isLoading={schemaGeneration.isLoading}
                isStreaming={schemaGeneration.isStreaming}
                onSubmit={(prompt) => schemaGeneration.generateStream({ prompt })}
              />
            }
          >
            <CustomToolSchemaField
              value={jsonSchema}
              onChange={(value) => {
                setJsonSchema(value)
                setSchemaError(value.trim() ? validateCustomToolSchema(value).error : null)
              }}
              error={!!schemaError}
              generation={schemaGeneration}
            />
          </SettingsSection>

          <SettingsSection
            label='Code'
            headerAccessory={codeError ? <FieldErrorText>{codeError}</FieldErrorText> : undefined}
            action={
              <GeneratePromptControl
                isLoading={codeGeneration.isLoading}
                isStreaming={codeGeneration.isStreaming}
                onSubmit={(prompt) => codeGeneration.generateStream({ prompt })}
              />
            }
          >
            <CustomToolCodeField
              value={functionCode}
              onChange={(value) => {
                setFunctionCode(value)
                if (codeError) setCodeError(null)
              }}
              error={!!codeError}
              generation={codeGeneration}
              schemaParameters={schemaParameters}
              workspaceId={workspaceId}
            />
          </SettingsSection>
        </div>
      </SettingsPanel>

      <ChipConfirmModal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        srTitle='Delete Custom Tool'
        title='Delete Custom Tool'
        text={CUSTOM_TOOL_DELETE_CONFIRM_TEXT}
        confirm={{
          label: 'Delete',
          onClick: handleConfirmDelete,
          pending: deleteTool.isPending,
          pendingLabel: 'Deleting...',
        }}
      />

      <UnsavedChangesModal
        open={guard.showUnsavedModal}
        onOpenChange={guard.setShowUnsavedModal}
        onDiscard={guard.confirmDiscard}
      />
    </>
  )
}
