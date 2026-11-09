'use client'

import { useMemo, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { getErrorMessage } from '@sim/utils/errors'
import {
  DetailHeader,
  SectionStack,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import { CustomToolCodeField } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/custom-tool-editor/custom-tool-code-field'
import {
  CUSTOM_TOOL_DELETE_DESCRIPTION,
  CustomToolError,
  CustomToolSchemaField,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/custom-tool-editor/custom-tool-editor'
import { GeneratePrompt } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/custom-tool-editor/generate-prompt'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/custom-tools/custom-tools.module.css'
import {
  type CustomToolDefinition,
  createLogger,
  useCreateCustomTool,
  useDeleteCustomTool,
  useUpdateCustomTool,
} from '@/platform/lib/data/custom-tools'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import {
  extractSchemaParameters,
  FUNCTION_NAME_LOCKED,
  useCodeGeneration,
  useSchemaGeneration,
  validateCustomToolSchema,
} from '@/platform/lib/data/workflow-editor/tool-input'

const logger = createLogger('CustomToolDetail')

/**
 * The tool's name and description as its schema declares them: `schema.function.name` is the
 * tool's title, so the heading follows the draft rather than a second place to edit it.
 */
function schemaIdentity(jsonSchema: string): { name: string | null; description: string | null } {
  try {
    const fn = JSON.parse(jsonSchema)?.function
    return {
      name: typeof fn?.name === 'string' && fn.name ? fn.name : null,
      description: typeof fn?.description === 'string' && fn.description ? fn.description : null,
    }
  } catch {
    return { name: null, description: null }
  }
}

interface CustomToolDetailProps {
  workspaceId: string
  /** `null` on the create flow, which starts from an empty draft. */
  tool: CustomToolDefinition | null
  /** Viewers without edit rights get the same page with every control inert. */
  readOnly: boolean
  onBack: () => void
  /** Lands on the tool just created. */
  onCreated: (toolId: string) => void
}

/**
 * One custom tool as a Settings sub-view: its schema and code stacked, each with AI generation,
 * Save and Discard beneath them, and Delete beside the heading. The fields are the workflow
 * editor's, so the two surfaces never drift.
 */
export function CustomToolDetail({
  workspaceId,
  tool,
  readOnly,
  onBack,
  onCreated,
}: CustomToolDetailProps) {
  const isEditing = tool !== null
  const createTool = useCreateCustomTool()
  const updateTool = useUpdateCustomTool()
  const deleteTool = useDeleteCustomTool()

  /**
   * The dirty baseline, seeded at mount (the list keys this view by tool id) and moved only by a
   * save, so a background refetch never shifts it under an edit.
   */
  const [seededSchema, setSeededSchema] = useState(() =>
    tool ? JSON.stringify(tool.schema, null, 2) : ''
  )
  const [seededCode, setSeededCode] = useState(() => tool?.code ?? '')
  const [jsonSchema, setJsonSchema] = useState(seededSchema)
  const [functionCode, setFunctionCode] = useState(seededCode)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const schemaParameters = useMemo(() => extractSchemaParameters(jsonSchema), [jsonSchema])
  const identity = useMemo(() => schemaIdentity(jsonSchema), [jsonSchema])

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

  const handleDiscard = () => {
    setJsonSchema(seededSchema)
    setFunctionCode(seededCode)
    setSchemaError(null)
    setCodeError(null)
  }

  const dirty = isEditing
    ? jsonSchema !== seededSchema || functionCode !== seededCode
    : jsonSchema.trim().length > 0 || functionCode.trim().length > 0
  const streaming = schemaGeneration.isStreaming || codeGeneration.isStreaming
  const saving = createTool.isPending || updateTool.isPending
  const controlsDisabled = readOnly || saving || deleteTool.isPending
  const isSchemaValid = useMemo(() => validateCustomToolSchema(jsonSchema).isValid, [jsonSchema])

  const guard = useSettingsUnsavedGuard({
    isDirty: dirty,
    navigationBlocked: saving || deleteTool.isPending || streaming,
    onDiscard: handleDiscard,
  })

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

    const schema: CustomToolDefinition['schema'] = JSON.parse(jsonSchema)
    const title = schema.function.name
    try {
      if (tool) {
        await updateTool.mutateAsync({
          workspaceId,
          toolId: tool.id,
          updates: { title, schema, code: functionCode },
        })
        setSeededSchema(jsonSchema)
        setSeededCode(functionCode)
      } else {
        const created = await createTool.mutateAsync({
          workspaceId,
          tool: { title, schema, code: functionCode },
        })
        // The upsert answers with the workspace's whole list, newest first: match by title.
        const createdId = created.find((candidate) => candidate.title === title)?.id
        if (createdId) onCreated(createdId)
        else onBack()
      }
    } catch (error) {
      logger.error('Failed to save custom tool', { error })
      const message = getErrorMessage(error, 'Failed to save custom tool')
      setSchemaError(
        message.includes('Cannot change function name') ? FUNCTION_NAME_LOCKED : message
      )
    }
  }

  const handleDelete = async () => {
    if (!tool) return
    try {
      await deleteTool.mutateAsync({ workspaceId, toolId: tool.id })
    } catch (error) {
      logger.error('Failed to delete custom tool', { error })
      throw error
    }
    onBack()
  }

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Custom tools'
        onBack={() => guard.guardBack(onBack)}
        title={identity.name || tool?.title || 'New tool'}
        description={
          identity.description ||
          tool?.schema.function.description ||
          'Define the JSON schema your agents call, and the code that runs.'
        }
      >
        {tool && !readOnly && (
          <Button
            variant='quiet'
            destructive
            disabled={deleteTool.isPending}
            onClick={() => setConfirmingDelete(true)}
          >
            {deleteTool.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        )}
      </DetailHeader>
      <SettingsSection title='Schema'>
        {(schemaError || !controlsDisabled) && (
          <div className={styles.bar}>
            {schemaError && <CustomToolError message={schemaError} />}
            {!controlsDisabled && (
              <GeneratePrompt
                isLoading={schemaGeneration.isLoading}
                isStreaming={schemaGeneration.isStreaming}
                onSubmit={(prompt) => schemaGeneration.generateStream({ prompt })}
              />
            )}
          </div>
        )}
        <CustomToolSchemaField
          value={jsonSchema}
          onChange={(value) => {
            if (controlsDisabled) return
            setJsonSchema(value)
            setSchemaError(value.trim() ? validateCustomToolSchema(value).error : null)
          }}
          isLoading={schemaGeneration.isLoading}
          isStreaming={schemaGeneration.isStreaming}
          invalid={Boolean(schemaError)}
          disabled={controlsDisabled}
        />
      </SettingsSection>
      <SettingsSection title='Code'>
        {(codeError || !controlsDisabled) && (
          <div className={styles.bar}>
            {codeError && <CustomToolError message={codeError} />}
            {!controlsDisabled && (
              <GeneratePrompt
                isLoading={codeGeneration.isLoading}
                isStreaming={codeGeneration.isStreaming}
                onSubmit={(prompt) => codeGeneration.generateStream({ prompt })}
              />
            )}
          </div>
        )}
        <CustomToolCodeField
          value={functionCode}
          onChange={(value) => {
            if (controlsDisabled) return
            setFunctionCode(value)
            if (codeError) setCodeError(null)
          }}
          isLoading={codeGeneration.isLoading}
          isStreaming={codeGeneration.isStreaming}
          schemaParameters={schemaParameters}
          workspaceId={workspaceId}
          disabled={controlsDisabled}
        />
      </SettingsSection>
      {!readOnly && (
        <SaveActions
          dirty={dirty}
          saving={saving}
          blocked={!isSchemaValid || streaming}
          onSave={() => void handleSave()}
          onDiscard={handleDiscard}
        />
      )}
      <ConfirmDialog
        target={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title='Delete Custom Tool'
        description={CUSTOM_TOOL_DELETE_DESCRIPTION}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        pending={deleteTool.isPending}
        onConfirm={handleDelete}
      />
    </SectionStack>
  )
}
