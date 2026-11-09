'use client'

import { useId, useMemo, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
import { CodeField } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/code-field/code-field'
import { highlightSyntax } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/code-field/highlight'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { EntryCard } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/entry-card/entry-card'
import { ActionField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/field-label-row/field-label-row'
import { FileUpload } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-upload'
import { getActiveWorkflowSearchHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/input-format/input-format.module.css'
import { ReferenceField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import {
  type SubBlockConfig,
  useAccessibleReferencePrefixes,
  useSubBlockInput,
  useSubBlockValue,
} from '@/platform/lib/data/workflow-editor'
import {
  controlValueToFiles,
  createDefaultInputFormatField,
  defaultFileFieldMode,
  filesToControlValue,
  type InputFormatFieldState,
  isFileFieldType,
  parseInputFormatFiles,
  serializeInputFormatFiles,
} from '@/platform/lib/data/workflow-editor/structured'

type Field = Pick<InputFormatFieldState, 'id' | 'name'> &
  Partial<Omit<InputFormatFieldState, 'id' | 'name'>>

type FileFieldMode = 'upload' | 'json'

interface InputFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
  config: SubBlockConfig
  /** Show each input's default value, which runs from the editor use. */
  showValue?: boolean
}

const TITLE = 'Input'
const NAME_PLACEHOLDER = 'firstName'
const VALUE_PLACEHOLDER = 'Enter default value'
const DESCRIPTION_PLACEHOLDER = 'Describe this field'

const TYPE_OPTIONS = [
  { label: 'String', value: 'string' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Object', value: 'object' },
  { label: 'Array', value: 'array' },
  { label: 'Files', value: 'file[]' },
] as const

const BOOLEAN_OPTIONS = [
  { label: 'true', value: 'true' },
  { label: 'false', value: 'false' },
]

const OBJECT_PLACEHOLDER = '{\n  "key": "value"\n}'
const ARRAY_PLACEHOLDER = '[\n  1, 2, 3\n]'
const FILES_PLACEHOLDER =
  '[\n  {\n    "data": "<base64>",\n    "type": "file",\n    "name": "document.pdf",\n    "mime": "application/pdf"\n  }\n]'

/** Drops control characters, quotes and backslashes from a field name, and trims it. */
const validateFieldName = (name: string): string => name.replace(/[\x00-\x1F"\\]/g, '').trim()

const highlightJson = (code: string) => highlightSyntax(code, 'json')

/**
 * The Start, API and Input triggers' input fields: each input's name, type, description and
 * default value (an uploader or JSON for files), folded or unfolded as stored, added after or
 * removed from the list, with the last one cleared rather than removed.
 */
export function InputFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  showValue = false,
}: InputFormatProps) {
  const baseId = useId()
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<Field[]>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const [fileFieldModes, setFileFieldModes] = useState<Record<string, FileFieldMode>>({})
  const [fallbackField] = useState<Field>(createDefaultInputFormatField)

  const controllerConfig = useMemo<SubBlockConfig>(
    () => ({ id: subBlockId, type: 'input-format', connectionDroppable: true }),
    [subBlockId]
  )
  const controller = useSubBlockInput({
    blockId,
    subBlockId,
    config: controllerConfig,
    isPreview,
    disabled,
  })

  const value = isPreview ? previewValue : storeValue
  const fields: Field[] = Array.isArray(value) && value.length > 0 ? value : [fallbackField]
  const isReadOnly = isPreview || disabled

  const addField = () => {
    if (isReadOnly) return
    setStoreValue([...fields, createDefaultInputFormatField()])
  }

  const removeField = (id: string) => {
    if (isReadOnly) return
    if (fields.length === 1) {
      setStoreValue([createDefaultInputFormatField()])
      return
    }
    setStoreValue(fields.filter((field) => field.id !== id))
  }

  const updateField = <Key extends keyof Field>(id: string, key: Key, next: Field[Key]) => {
    if (isReadOnly) return
    const updated = key === 'name' && typeof next === 'string' ? validateFieldName(next) : next
    setStoreValue(fields.map((field) => (field.id === id ? { ...field, [key]: updated } : field)))
  }

  const toggleCollapse = (id: string) => {
    if (isReadOnly) return
    setStoreValue(
      fields.map((field) => (field.id === id ? { ...field, collapsed: !field.collapsed } : field))
    )
  }

  const fileFieldMode = (field: Field): { mode: FileFieldMode; canUseUploader: boolean } => {
    const canUseUploader = defaultFileFieldMode(field.value) === 'upload'
    return {
      mode: canUseUploader ? (fileFieldModes[field.id] ?? 'upload') : 'json',
      canUseUploader,
    }
  }

  const renderValueControl = (field: Field, index: number) => {
    const fieldValue = field.value ?? ''
    const setValue = (next: string) => updateField(field.id, 'value', next)

    if (field.type === 'boolean')
      return (
        <SearchableSelect
          label='Value'
          labelHidden
          searchLabel='Search values'
          placeholder='Select value'
          options={BOOLEAN_OPTIONS}
          value={fieldValue || null}
          onValueChange={(next) => {
            if (next !== null && !isReadOnly) setValue(next)
          }}
          disabled={isReadOnly}
        />
      )

    if (field.type === 'object' || field.type === 'array')
      return (
        <CodeField
          label='Value'
          value={fieldValue}
          onValueChange={setValue}
          highlight={highlightJson}
          placeholder={field.type === 'object' ? OBJECT_PLACEHOLDER : ARRAY_PLACEHOLDER}
          disabled={isReadOnly}
        />
      )

    if (isFileFieldType(field.type)) {
      if (fileFieldMode(field).mode === 'upload') {
        const currentFiles = parseInputFormatFiles(field.value)
        return (
          <FileUpload
            blockId={blockId}
            subBlockId={subBlockId}
            multiple
            disabled={isReadOnly}
            value={filesToControlValue(currentFiles)}
            onValueChange={(next) =>
              setValue(serializeInputFormatFiles(controlValueToFiles(next, currentFiles)))
            }
          />
        )
      }
      return (
        <CodeField
          label='Value'
          value={fieldValue}
          onValueChange={setValue}
          highlight={highlightJson}
          placeholder={FILES_PLACEHOLDER}
          disabled={isReadOnly}
        />
      )
    }

    return (
      <ReferenceField
        id={`${baseId}-${field.id}-value`}
        label='Value'
        blockId={blockId}
        value={fieldValue}
        onChange={setValue}
        controller={controller}
        fieldKey={field.id}
        placeholder={VALUE_PLACEHOLDER}
        disabled={isReadOnly}
        accessiblePrefixes={accessiblePrefixes}
        searchHighlight={getActiveWorkflowSearchHighlight({
          activeSearchTarget,
          blockId,
          subBlockId,
          valuePath: [index, 'value'],
        })}
      />
    )
  }

  const renderFileModeToggle = (field: Field) => {
    const { mode, canUseUploader } = fileFieldMode(field)
    if (!canUseUploader) return null
    return (
      <Button
        variant='quiet'
        size='compact'
        aria-label={mode === 'upload' ? 'Switch to JSON' : 'Switch to file uploader'}
        disabled={isReadOnly}
        onClick={() =>
          setFileFieldModes((prev) => ({
            ...prev,
            [field.id]: mode === 'upload' ? 'json' : 'upload',
          }))
        }
      >
        {mode === 'upload' ? 'JSON' : 'Upload'}
      </Button>
    )
  }

  return (
    <div className={styles.entries}>
      {fields.map((field, index) => {
        const fieldId = `${baseId}-${field.id}`
        const entryLabel = `${TITLE} ${index + 1}`
        return (
          <EntryCard
            key={field.id}
            label={entryLabel}
            title={field.name || entryLabel}
            typeTag={field.name ? field.type : undefined}
            collapsed={Boolean(field.collapsed)}
            onToggle={isReadOnly ? undefined : () => toggleCollapse(field.id)}
            actions={
              <>
                <IconButton
                  label={`Add ${TITLE.toLowerCase()}`}
                  icon='I074'
                  size='compact'
                  disabled={isReadOnly}
                  onClick={addField}
                />
                <IconButton
                  label={`Delete ${TITLE.toLowerCase()}`}
                  icon='I105'
                  size='compact'
                  disabled={isReadOnly}
                  onClick={() => removeField(field.id)}
                />
              </>
            }
          >
            <FieldFrame id={`${fieldId}-name`} label='Name'>
              <ReferenceField
                id={`${fieldId}-name`}
                label='Name'
                blockId={blockId}
                value={field.name ?? ''}
                onChange={(next) => updateField(field.id, 'name', next)}
                controller={controller}
                fieldKey={`name-${field.id}`}
                placeholder={NAME_PLACEHOLDER}
                disabled={isReadOnly}
                accessiblePrefixes={accessiblePrefixes}
                searchHighlight={getActiveWorkflowSearchHighlight({
                  activeSearchTarget,
                  blockId,
                  subBlockId,
                  valuePath: [index, 'name'],
                })}
              />
            </FieldFrame>
            <Select
              label='Type'
              field={{}}
              options={TYPE_OPTIONS}
              value={field.type ?? 'string'}
              onValueChange={(next) => updateField(field.id, 'type', next)}
              disabled={isReadOnly}
            />
            <FieldFrame id={`${fieldId}-description`} label='Description'>
              <ReferenceField
                id={`${fieldId}-description`}
                label='Description'
                blockId={blockId}
                value={field.description ?? ''}
                onChange={(next) => updateField(field.id, 'description', next)}
                placeholder={DESCRIPTION_PLACEHOLDER}
                disabled={isReadOnly}
                accessiblePrefixes={accessiblePrefixes}
                searchHighlight={getActiveWorkflowSearchHighlight({
                  activeSearchTarget,
                  blockId,
                  subBlockId,
                  valuePath: [index, 'description'],
                })}
              />
            </FieldFrame>
            {showValue && (
              <ActionField
                label='Value'
                actions={isFileFieldType(field.type) && renderFileModeToggle(field)}
              >
                {renderValueControl(field, index)}
              </ActionField>
            )}
          </EntryCard>
        )
      })}
    </div>
  )
}
