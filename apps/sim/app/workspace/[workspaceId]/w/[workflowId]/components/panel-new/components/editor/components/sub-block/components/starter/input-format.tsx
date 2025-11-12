import { useRef } from 'react'
import { Plus } from 'lucide-react'
import { Trash } from '@/components/emcn/icons/trash'
import 'prismjs/components/prism-json'
import Editor from 'react-simple-code-editor'
import { Badge, Button, Combobox, Input } from '@/components/emcn'
import {
  Code,
  calculateGutterWidth,
  getCodeEditorProps,
  highlight,
  languages,
} from '@/components/emcn/components/code/code'
import type { ComboboxOption } from '@/components/emcn/components/combobox/combobox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'

interface Field {
  id: string
  name: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
  value?: string
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
  valuePlaceholder?: string
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
  { label: 'Files', value: 'files' },
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
  collapsed: false,
})

/**
 * Validates and sanitizes field names by removing control characters and quotes
 */
const validateFieldName = (name: string): string => name.replace(/[\x00-\x1F"\\]/g, '').trim()

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
  valuePlaceholder = 'Enter test value',
  config,
}: FieldFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<Field[]>(blockId, subBlockId)
  const valueInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement>>({})
  const overlayRefs = useRef<Record<string, HTMLDivElement>>({})
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
   * Removes a field by ID, preventing removal of the last field
   */
  const removeField = (id: string) => {
    if (isReadOnly || fields.length === 1) return
    setStoreValue(fields.filter((field) => field.id !== id))
  }

  /**
   * Updates a specific field property
   */
  const updateField = (id: string, field: keyof Field, value: any) => {
    if (isReadOnly) return

    const updatedValue =
      field === 'name' && typeof value === 'string' ? validateFieldName(value) : value

    setStoreValue(fields.map((f) => (f.id === id ? { ...f, [field]: updatedValue } : f)))
  }

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
   * Renders the field header with name, type badge, and action buttons
   */
  const renderFieldHeader = (field: Field, index: number) => (
    <div
      className='flex cursor-pointer items-center justify-between bg-transparent px-[10px] py-[5px]'
      onClick={() => toggleCollapse(field.id)}
    >
      <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
        <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
          {field.name || `${title} ${index + 1}`}
        </span>
        {field.name && showType && <Badge className='h-[20px] text-[13px]'>{field.type}</Badge>}
      </div>
      <div className='flex items-center gap-[8px] pl-[8px]' onClick={(e) => e.stopPropagation()}>
        <Button variant='ghost' onClick={addField} disabled={isReadOnly} className='h-auto p-0'>
          <Plus className='h-[14px] w-[14px]' />
          <span className='sr-only'>Add {title}</span>
        </Button>
        <Button
          variant='ghost'
          onClick={() => removeField(field.id)}
          disabled={isReadOnly || fields.length === 1}
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
              onValueChange={(newValue) => {
                if (!isReadOnly) {
                  updateField(field.id, 'value', newValue)
                }
              }}
              highlight={(code) => highlight(code, languages.json, 'json')}
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
              onValueChange={(newValue) => {
                if (!isReadOnly) {
                  updateField(field.id, 'value', newValue)
                }
              }}
              highlight={(code) => highlight(code, languages.json, 'json')}
              disabled={isReadOnly}
              {...getCodeEditorProps({ disabled: isReadOnly })}
            />
          </Code.Content>
        </Code.Container>
      )
    }

    if (field.type === 'files') {
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
                '[\n  {\n    "data": "data:application/pdf;base64,...",\n    "type": "file",\n    "name": "document.pdf",\n    "mime": "application/pdf"\n  }\n]'
              }
            </Code.Placeholder>
            <Editor
              value={fieldValue}
              onValueChange={(newValue) => {
                if (!isReadOnly) {
                  updateField(field.id, 'value', newValue)
                }
              }}
              highlight={(code) => highlight(code, languages.json, 'json')}
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
          className={cn('allow-scroll w-full overflow-auto', inputClassName)}
          style={{ overflowX: 'auto' }}
        />
        <div
          ref={(el) => {
            if (el) overlayRefs.current[field.id] = el
          }}
          className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm'
          style={{ overflowX: 'auto' }}
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
            'rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F]',
            field.collapsed ? 'overflow-hidden' : 'overflow-visible'
          )}
        >
          {renderFieldHeader(field, index)}

          {!field.collapsed && (
            <div className='flex flex-col gap-[6px] border-[var(--border-strong)] border-t px-[10px] pt-[6px] pb-[10px]'>
              <div className='flex flex-col gap-[4px]'>
                <Label className='text-[13px]'>Name</Label>
                <Input
                  name='name'
                  value={field.name}
                  onChange={(e) => updateField(field.id, 'name', e.target.value)}
                  placeholder={placeholder}
                  disabled={isReadOnly}
                  autoComplete='off'
                />
              </div>

              {showType && (
                <div className='space-y-[4px]'>
                  <Label className='text-[13px]'>Type</Label>
                  <Combobox
                    options={TYPE_OPTIONS}
                    value={field.type}
                    onChange={(value) => updateField(field.id, 'type', value)}
                    disabled={isReadOnly}
                  />
                </div>
              )}

              {showValue && (
                <div className='space-y-[4px]'>
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

// Export specific components for backward compatibility
export function InputFormat(props: Omit<FieldFormatProps, 'title' | 'placeholder'>) {
  return <FieldFormat {...props} title='Input' placeholder='firstName' />
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
