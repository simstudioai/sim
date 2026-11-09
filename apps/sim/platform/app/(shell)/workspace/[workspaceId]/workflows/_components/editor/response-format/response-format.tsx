'use client'

import { useId, useMemo, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { CodeField } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/code-field/code-field'
import { highlightSyntax } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/code-field/highlight'
import { useActiveSearchTarget } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { EntryCard } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/entry-card/entry-card'
import { FileUpload } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-upload'
import { getActiveWorkflowSearchHighlight } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { ReferenceField } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/response-format/response-format.module.css'
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

/** A response field as stored: an id and a name, the rest filled in as the author edits. */
type ResponseField = Pick<InputFormatFieldState, 'id' | 'name'> &
  Partial<Omit<InputFormatFieldState, 'id' | 'name'>>

type FileFieldMode = 'upload' | 'json'

const TITLE = 'Field'
const NAME_PLACEHOLDER = 'output'
const VALUE_PLACEHOLDER = 'Enter return value'
const OBJECT_PLACEHOLDER = '{\n  "key": "value"\n}'
const ARRAY_PLACEHOLDER = '[\n  1, 2, 3\n]'
const FILES_PLACEHOLDER =
  '[\n  {\n    "data": "<base64>",\n    "type": "file",\n    "name": "document.pdf",\n    "mime": "application/pdf"\n  }\n]'

const BOOLEAN_OPTIONS = [
  { label: 'true', value: 'true' },
  { label: 'false', value: 'false' },
]

/** Drops control characters, quotes and backslashes from a field name, and trims it. */
const validateFieldName = (name: string): string => name.replace(/[\x00-\x1F"\\]/g, '').trim()

const highlightJson = (code: string) => highlightSyntax(code, 'json')

interface ResponseFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  config: SubBlockConfig
  disabled?: boolean
}

/**
 * The Response and Human in the Loop blocks' response structure: named fields, each returning a
 * value (text with references, a boolean, JSON for an object or array, or files as an uploader or
 * JSON), folded or unfolded as stored, added to or removed from the list, with the last one
 * cleared rather than removed.
 */
export function ResponseFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: ResponseFormatProps) {
  const baseId = useId()
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<ResponseField[]>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const [fileFieldModes, setFileFieldModes] = useState<Record<string, FileFieldMode>>({})
  const [fallbackField] = useState<ResponseField>(createDefaultInputFormatField)

  const controllerConfig = useMemo<SubBlockConfig>(
    () => ({ id: subBlockId, type: 'response-format', connectionDroppable: true }),
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
  const fields: ResponseField[] = Array.isArray(value) && value.length > 0 ? value : [fallbackField]
  const isReadOnly = isPreview || disabled

  const searchHighlight = (index: number, key: 'name' | 'value') =>
    getActiveWorkflowSearchHighlight({
      activeSearchTarget,
      blockId,
      subBlockId,
      valuePath: [index, key],
    })

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

  const updateField = <Key extends keyof ResponseField>(
    id: string,
    key: Key,
    next: ResponseField[Key]
  ) => {
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

  /**
   * The uploader is offered only while it can show the stored value losslessly (empty, or every
   * entry a run-ready file); anything else stays in JSON so saving cannot drop what it cannot show.
   */
  const fileFieldMode = (
    field: ResponseField
  ): { mode: FileFieldMode; canUseUploader: boolean } => {
    const canUseUploader = defaultFileFieldMode(field.value) === 'upload'
    return {
      mode: canUseUploader ? (fileFieldModes[field.id] ?? 'upload') : 'json',
      canUseUploader,
    }
  }

  const renderValueControl = (field: ResponseField, index: number) => {
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
            acceptedTypes='*'
            multiple
            requiresCloudStorage={false}
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
        searchHighlight={searchHighlight(index, 'value')}
      />
    )
  }

  const renderFileModeToggle = (field: ResponseField) => {
    const { mode, canUseUploader } = fileFieldMode(field)
    if (!canUseUploader) return null
    return (
      <IconButton
        label={mode === 'upload' ? 'Switch to JSON' : 'Switch to file uploader'}
        icon={mode === 'upload' ? 'type-json' : 'I117'}
        size='compact'
        tooltip
        disabled={isReadOnly}
        onClick={() =>
          setFileFieldModes((current) => ({
            ...current,
            [field.id]: mode === 'upload' ? 'json' : 'upload',
          }))
        }
      />
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
            collapsed={Boolean(field.collapsed)}
            onToggle={isReadOnly ? undefined : () => toggleCollapse(field.id)}
            actions={
              isPreview ? undefined : (
                <>
                  <IconButton
                    label='Add field'
                    icon='I074'
                    size='compact'
                    tooltip
                    disabled={isReadOnly}
                    onClick={addField}
                  />
                  <IconButton
                    label='Delete field'
                    icon='I105'
                    size='compact'
                    tooltip
                    disabled={isReadOnly}
                    onClick={() => removeField(field.id)}
                  />
                </>
              )
            }
          >
            <div className={styles.field}>
              <label className={styles.label} data-type='T059' htmlFor={`${fieldId}-name`}>
                Name
              </label>
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
                searchHighlight={searchHighlight(index, 'name')}
              />
            </div>
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <span className={styles.label} data-type='T059'>
                  Value
                </span>
                {isFileFieldType(field.type) && renderFileModeToggle(field)}
              </div>
              {renderValueControl(field, index)}
            </div>
          </EntryCard>
        )
      })}
    </div>
  )
}
