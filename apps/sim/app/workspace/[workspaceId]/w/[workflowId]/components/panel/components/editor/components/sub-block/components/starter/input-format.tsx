import { useCallback, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Trash } from '@/components/emcn/icons/trash'
import 'prismjs/components/prism-json'
import Editor from 'react-simple-code-editor'
import {
  Badge,
  Button,
  Code,
  Combobox,
  type ComboboxOption,
  calculateGutterWidth,
  getCodeEditorProps,
  highlight,
  Input,
  languages,
} from '@/components/emcn'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/core/utils/cn'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'

interface Field {
  id: string
  name: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file[]'
  value?: string
  description?: string
  collapsed?: boolean
}

interface FieldFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: Field[] | null
  disabled?: boolean
  title?: string
  placeholder?: string
  showType?: boolean
  showValue?: boolean
  showDescription?: boolean
  valuePlaceholder?: string
  descriptionPlaceholder?: string
  config?: any
}

/**
 * Type options for field type selection
 */
const TYPE_OPTIONS: ComboboxOption[] = [
  { label: 'String', value: 'string' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Object', value: 'object' },
  { label: 'Array', value: 'array' },
  { label: 'Files', value: 'file[]' },
]

/**
 * Boolean value options for Combobox
 */
const BOOLEAN_OPTIONS: ComboboxOption[] = [
  { label: 'true', value: 'true' },
  { label: 'false', value: 'false' },
]

/**
 * Creates a new field with default values
 */
const createDefaultField = (): Field => ({
  id: crypto.randomUUID(),
  name: '',
  type: 'string',
  value: '',
  description: '',
  collapsed: false,
})

/**
 * Validates and sanitizes field names by removing control characters and quotes
 */
const validateFieldName = (name: string): string => name.replace(/[\x00-\x1F"\\]/g, '').trim()

const jsonHighlight = (code: string): string => highlight(code, languages.json, 'json')

export function FieldFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  title = 'Field',
  placeholder = 'fieldName',
  showType = true,
  showValue = false,
  showDescription = false,
  valuePlaceholder = 'Enter default value',
  descriptionPlaceholder = 'Describe this field',
}: FieldFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<Field[]>(blockId, subBlockId)
  const valueInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement>>({})
  const nameInputRefs = useRef<Record<string, HTMLInputElement>>({})
  const overlayRefs = useRef<Record<string, HTMLDivElement>>({})
  const nameOverlayRefs = useRef<Record<string, HTMLDivElement>>({})
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const inputController = useSubBlockInput({
    blockId,
    subBlockId,
    config: {
      id: subBlockId,
      type: 'input-format',
      connectionDroppable: true,
    },
    isPreview,
    disabled,
  })

  const value = isPreview ? previewValue : storeValue
  const fields: Field[] = Array.isArray(value) && value.length > 0 ? value : [createDefaultField()]
  const isReadOnly = isPreview || disabled

  /**
   * Adds a new field to the list
   */
  const addField = () => {
    if (isReadOnly) return
    setStoreValue([...fields, createDefaultField()])
  }

  /**
   * Removes a field by ID, or clears it if it's the last field
   */
  const removeField = (id: string) => {
    if (isReadOnly) return

    if (fields.length === 1) {
      setStoreValue([createDefaultField()])
      return
    }

    setStoreValue(fields.filter((field) => field.id !== id))
  }

  const storeValueRef = useRef(storeValue)
  storeValueRef.current = storeValue

  const isReadOnlyRef = useRef(isReadOnly)
  isReadOnlyRef.current = isReadOnly

  const setStoreValueRef = useRef(setStoreValue)
  setStoreValueRef.current = setStoreValue

  const updateField = useCallback(
    (id: string, fieldKey: keyof Field, fieldValue: Field[keyof Field]) => {
      if (isReadOnlyRef.current) return

      const updatedValue =
        fieldKey === 'name' && typeof fieldValue === 'string'
          ? validateFieldName(fieldValue)
          : fieldValue

      const currentStoreValue = storeValueRef.current
      const currentFields: Field[] =
        Array.isArray(currentStoreValue) && currentStoreValue.length > 0
          ? currentStoreValue
          : [createDefaultField()]

      setStoreValueRef.current(
        currentFields.map((f) => (f.id === id ? { ...f, [fieldKey]: updatedValue } : f))
      )
    },
    []
  )

  const editorValueChangeHandlersRef = useRef<Record<string, (newValue: string) => void>>({})

  const getEditorValueChangeHandler = useCallback(
    (fieldId: string): ((newValue: string) => void) => {
      if (!editorValueChangeHandlersRef.current[fieldId]) {
        editorValueChangeHandlersRef.current[fieldId] = (newValue: string) => {
          updateField(fieldId, 'value', newValue)
        }
      }
      return editorValueChangeHandlersRef.current[fieldId]
    },
    [updateField]
  )

  /**
   * Toggles the collapsed state of a field
   */
  const toggleCollapse = (id: string) => {
    if (isReadOnly) return
    setStoreValue(fields.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)))
  }

  /**
   * Syncs scroll position between input and overlay for text highlighting
   */
  const syncOverlayScroll = (fieldId: string, scrollLeft: number) => {
    const overlay = overlayRefs.current[fieldId]
    if (overlay) overlay.scrollLeft = scrollLeft
  }

  /**
   * Syncs scroll position between name input and overlay for text highlighting
   */
  const syncNameOverlayScroll = (fieldId: string, scrollLeft: number) => {
    const overlay = nameOverlayRefs.current[fieldId]
    if (overlay) overlay.scrollLeft = scrollLeft
  }

  /**
   * Generates a unique field key for name inputs to avoid collision with value inputs
   */
  const getNameFieldKey = (fieldId: string) => `name-${fieldId}`

  /**
   * Renders the name input field with tag dropdown support
   */
  const renderNameInput = (field: Field) => {
    const nameFieldKey = getNameFieldKey(field.id)
    const fieldValue = field.name ?? ''
    const fieldState = inputController.fieldHelpers.getFieldState(nameFieldKey)
    const handlers = inputController.fieldHelpers.createFieldHandlers(
      nameFieldKey,
      fieldValue,
      (newValue) => updateField(field.id, 'name', newValue)
    )
    const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
      nameFieldKey,
      fieldValue,
      (newValue) => updateField(field.id, 'name', newValue)
    )

    const inputClassName = cn('text-transparent caret-foreground')

    return (
      <>
        <Input
          ref={(el) => {
            if (el) nameInputRefs.current[field.id] = el
          }}
          name='name'
          value={fieldValue}
          onChange={handlers.onChange}
          onKeyDown={handlers.onKeyDown}
          onDrop={handlers.onDrop}
          onDragOver={handlers.onDragOver}
          onFocus={handlers.onFocus}
          onScroll={(e) => syncNameOverlayScroll(field.id, e.currentTarget.scrollLeft)}
          onPaste={() =>
            setTimeout(() => {
              const input = nameInputRefs.current[field.id]
              input && syncNameOverlayScroll(field.id, input.scrollLeft)
            }, 0)
          }
          placeholder={placeholder}
          disabled={isReadOnly}
          autoComplete='off'
          className={cn('allow-scroll w-full overflow-x-auto overflow-y-hidden', inputClassName)}
        />
        <div
          ref={(el) => {
            if (el) nameOverlayRefs.current[field.id] = el
          }}
          className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm'
          style={{ scrollbarWidth: 'none' }}
        >
          <div
            className='w-full whitespace-pre'
            style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
          >
            {formatDisplayText(
              fieldValue,
              accessiblePrefixes ? { accessiblePrefixes } : { highlightAll: true }
            )}
          </div>
        </div>
        {fieldState.showTags && (
          <TagDropdown
            visible={fieldState.showTags}
            onSelect={tagSelectHandler}
            blockId={blockId}
            activeSourceBlockId={fieldState.activeSourceBlockId}
            inputValue={fieldValue}
            cursorPosition={fieldState.cursorPosition}
            onClose={() => inputController.fieldHelpers.hideFieldDropdowns(nameFieldKey)}
            inputRef={{ current: nameInputRefs.current[field.id] || null }}
          />
        )}
      </>
    )
  }

  /**
   * Renders the field header with name, type badge, and action buttons
   */
  const renderFieldHeader = (field: Field, index: number) => (
    <div
      className='flex cursor-pointer items-center justify-between rounded-t-[4px] bg-[var(--surface-4)] px-[10px] py-[5px]'
      onClick={() => toggleCollapse(field.id)}
    >
      <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
        <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
          {field.name || `${title} ${index + 1}`}
        </span>
        {field.name && showType && (
          <Badge variant='type' size='sm'>
            {field.type}
          </Badge>
        )}
      </div>
      <div className='flex items-center gap-[8px] pl-[8px]' onClick={(e) => e.stopPropagation()}>
        <Button variant='ghost' onClick={addField} disabled={isReadOnly} className='h-auto p-0'>
          <Plus className='h-[14px] w-[14px]' />
          <span className='sr-only'>Add {title}</span>
        </Button>
        <Button
          variant='ghost'
          onClick={() => removeField(field.id)}
          disabled={isReadOnly}
          className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
        >
          <Trash className='h-[14px] w-[14px]' />
          <span className='sr-only'>Delete Field</span>
        </Button>
      </div>
    </div>
  )

  /**
   * Renders the value input field based on the field type
   */
  const renderValueInput = (field: Field) => {
    if (field.type === 'boolean') {
      return (
        <Combobox
          options={BOOLEAN_OPTIONS}
          value={field.value ?? ''}
          onChange={(v) => !isReadOnly && updateField(field.id, 'value', v)}
          placeholder='Select value'
          disabled={isReadOnly}
        />
      )
    }

    const fieldValue = field.value ?? ''
    const fieldState = inputController.fieldHelpers.getFieldState(field.id)
    const handlers = inputController.fieldHelpers.createFieldHandlers(
      field.id,
      fieldValue,
      (newValue) => updateField(field.id, 'value', newValue)
    )
    const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
      field.id,
      fieldValue,
      (newValue) => updateField(field.id, 'value', newValue)
    )

    const inputClassName = cn('text-transparent caret-foreground')

    const tagDropdown = fieldState.showTags && (
      <TagDropdown
        visible={fieldState.showTags}
        onSelect={tagSelectHandler}
        blockId={blockId}
        activeSourceBlockId={fieldState.activeSourceBlockId}
        inputValue={fieldValue}
        cursorPosition={fieldState.cursorPosition}
        onClose={() => inputController.fieldHelpers.hideFieldDropdowns(field.id)}
        inputRef={{ current: valueInputRefs.current[field.id] || null }}
      />
    )

    if (field.type === 'object') {
      const lineCount = fieldValue.split('\n').length
      const gutterWidth = calculateGutterWidth(lineCount)

      const renderLineNumbers = () => {
        return Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            className='font-medium font-mono text-[var(--text-muted)] text-xs'
            style={{ height: `${21}px`, lineHeight: `${21}px` }}
          >
            {i + 1}
          </div>
        ))
      }

      return (
        <Code.Container className='min-h-[120px]'>
          <Code.Gutter width={gutterWidth}>{renderLineNumbers()}</Code.Gutter>
          <Code.Content paddingLeft={`${gutterWidth}px`}>
            <Code.Placeholder gutterWidth={gutterWidth} show={fieldValue.length === 0}>
              {'{\n  "key": "value"\n}'}
            </Code.Placeholder>
            <Editor
              value={fieldValue}
              onValueChange={getEditorValueChangeHandler(field.id)}
              highlight={jsonHighlight}
              disabled={isReadOnly}
              {...getCodeEditorProps({ disabled: isReadOnly })}
            />
          </Code.Content>
        </Code.Container>
      )
    }

    if (field.type === 'array') {
      const lineCount = fieldValue.split('\n').length
      const gutterWidth = calculateGutterWidth(lineCount)

      const renderLineNumbers = () => {
        return Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            className='font-medium font-mono text-[var(--text-muted)] text-xs'
            style={{ height: `${21}px`, lineHeight: `${21}px` }}
          >
            {i + 1}
          </div>
        ))
      }

      return (
        <Code.Container className='min-h-[120px]'>
          <Code.Gutter width={gutterWidth}>{renderLineNumbers()}</Code.Gutter>
          <Code.Content paddingLeft={`${gutterWidth}px`}>
            <Code.Placeholder gutterWidth={gutterWidth} show={fieldValue.length === 0}>
              {'[\n  1, 2, 3\n]'}
            </Code.Placeholder>
            <Editor
              value={fieldValue}
              onValueChange={getEditorValueChangeHandler(field.id)}
              highlight={jsonHighlight}
              disabled={isReadOnly}
              {...getCodeEditorProps({ disabled: isReadOnly })}
            />
          </Code.Content>
        </Code.Container>
      )
    }

    if (field.type === 'file[]') {
      const lineCount = fieldValue.split('\n').length
      const gutterWidth = calculateGutterWidth(lineCount)

      const renderLineNumbers = () => {
        return Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            className='font-medium font-mono text-[var(--text-muted)] text-xs'
            style={{ height: `${21}px`, lineHeight: `${21}px` }}
          >
            {i + 1}
          </div>
        ))
      }

      return (
        <Code.Container className='min-h-[120px]'>
          <Code.Gutter width={gutterWidth}>{renderLineNumbers()}</Code.Gutter>
          <Code.Content paddingLeft={`${gutterWidth}px`}>
            <Code.Placeholder gutterWidth={gutterWidth} show={fieldValue.length === 0}>
              {
                '[\n  {\n    "data": "<base64>",\n    "type": "file",\n    "name": "document.pdf",\n    "mime": "application/pdf"\n  }\n]'
              }
            </Code.Placeholder>
            <Editor
              value={fieldValue}
              onValueChange={getEditorValueChangeHandler(field.id)}
              highlight={jsonHighlight}
              disabled={isReadOnly}
              {...getCodeEditorProps({ disabled: isReadOnly })}
            />
          </Code.Content>
        </Code.Container>
      )
    }

    return (
      <>
        <Input
          ref={(el) => {
            if (el) valueInputRefs.current[field.id] = el
          }}
          name='value'
          value={fieldValue}
          onChange={handlers.onChange}
          onKeyDown={handlers.onKeyDown}
          onDrop={handlers.onDrop}
          onDragOver={handlers.onDragOver}
          onFocus={handlers.onFocus}
          onScroll={(e) => syncOverlayScroll(field.id, e.currentTarget.scrollLeft)}
          onPaste={() =>
            setTimeout(() => {
              const input = valueInputRefs.current[field.id] as HTMLInputElement | undefined
              input && syncOverlayScroll(field.id, input.scrollLeft)
            }, 0)
          }
          placeholder={valuePlaceholder}
          disabled={isReadOnly}
          autoComplete='off'
          className={cn('allow-scroll w-full overflow-x-auto overflow-y-hidden', inputClassName)}
        />
        <div
          ref={(el) => {
            if (el) overlayRefs.current[field.id] = el
          }}
          className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm'
          style={{ scrollbarWidth: 'none' }}
        >
          <div
            className='w-full whitespace-pre'
            style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
          >
            {formatDisplayText(
              fieldValue,
              accessiblePrefixes ? { accessiblePrefixes } : { highlightAll: true }
            )}
          </div>
        </div>
        {tagDropdown}
      </>
    )
  }

  return (
    <div className='space-y-[8px]'>
      {fields.map((field, index) => (
        <div
          key={field.id}
          data-field-id={field.id}
          className={cn(
            'rounded-[4px] border border-[var(--border-1)]',
            field.collapsed ? 'overflow-hidden' : 'overflow-visible'
          )}
        >
          {renderFieldHeader(field, index)}

          {!field.collapsed && (
            <div className='flex flex-col gap-[8px] border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
              <div className='flex flex-col gap-[6px]'>
                <Label className='text-[13px]'>Name</Label>
                <div className='relative'>{renderNameInput(field)}</div>
              </div>

              {showType && (
                <div className='flex flex-col gap-[6px]'>
                  <Label className='text-[13px]'>Type</Label>
                  <Combobox
                    options={TYPE_OPTIONS}
                    value={field.type}
                    onChange={(value) => updateField(field.id, 'type', value)}
                    disabled={isReadOnly}
                  />
                </div>
              )}

              {showDescription && (
                <div className='flex flex-col gap-[6px]'>
                  <Label className='text-[13px]'>Description</Label>
                  <Input
                    value={field.description ?? ''}
                    onChange={(e) => updateField(field.id, 'description', e.target.value)}
                    placeholder={descriptionPlaceholder}
                    disabled={isReadOnly}
                  />
                </div>
              )}

              {showValue && (
                <div className='flex flex-col gap-[6px]'>
                  <Label className='text-[13px]'>Value</Label>
                  <div className='relative'>{renderValueInput(field)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function InputFormat(
  props: Omit<FieldFormatProps, 'title' | 'placeholder' | 'showDescription'>
) {
  return <FieldFormat {...props} title='Input' placeholder='firstName' showDescription={true} />
}

export function ResponseFormat(
  props: Omit<
    FieldFormatProps,
    'title' | 'placeholder' | 'showType' | 'showValue' | 'valuePlaceholder'
  >
) {
  return (
    <FieldFormat
      {...props}
      title='Field'
      placeholder='output'
      showType={false}
      showValue={true}
      valuePlaceholder='Enter return value'
    />
  )
}

export type { Field as InputField, Field as ResponseField }
