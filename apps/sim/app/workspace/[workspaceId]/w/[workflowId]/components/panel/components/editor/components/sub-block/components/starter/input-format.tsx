import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
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
import {
  isLikelyReferenceSegment,
  SYSTEM_REFERENCE_PREFIXES,
  splitReferenceSegment,
} from '@/lib/workflows/sanitization/references'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { createEnvVarPattern, createReferencePattern } from '@/executor/utils/reference-validation'
import { useTagSelection } from '@/hooks/kb/use-tag-selection'
import { normalizeName } from '@/stores/workflows/utils'

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

/**
 * Placeholder type for code highlighting
 */
interface CodePlaceholder {
  placeholder: string
  original: string
  type: 'var' | 'env'
}

/**
 * Creates a syntax highlighter function with custom reference and environment variable highlighting.
 */
const createHighlightFunction = (
  shouldHighlightReference: (part: string) => boolean
): ((codeToHighlight: string) => string) => {
  return (codeToHighlight: string): string => {
    const placeholders: CodePlaceholder[] = []
    let processedCode = codeToHighlight

    processedCode = processedCode.replace(createEnvVarPattern(), (match) => {
      const placeholder = `__ENV_VAR_${placeholders.length}__`
      placeholders.push({ placeholder, original: match, type: 'env' })
      return placeholder
    })

    processedCode = processedCode.replace(createReferencePattern(), (match) => {
      if (shouldHighlightReference(match)) {
        const placeholder = `__VAR_REF_${placeholders.length}__`
        placeholders.push({ placeholder, original: match, type: 'var' })
        return placeholder
      }
      return match
    })

    let highlightedCode = highlight(processedCode, languages.json, 'json')

    placeholders.forEach(({ placeholder, original, type }) => {
      if (type === 'env') {
        highlightedCode = highlightedCode.replace(
          placeholder,
          `<span style="color: var(--brand-secondary);">${original}</span>`
        )
      } else if (type === 'var') {
        const escaped = original.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        highlightedCode = highlightedCode.replace(
          placeholder,
          `<span style="color: var(--brand-secondary);">${escaped}</span>`
        )
      }
    })

    return highlightedCode
  }
}

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
  valuePlaceholder = 'Enter default value',
}: FieldFormatProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [storeValue, setStoreValue] = useSubBlockValue<Field[]>(blockId, subBlockId)
  const valueInputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement>>({})
  const nameInputRefs = useRef<Record<string, HTMLInputElement>>({})
  const overlayRefs = useRef<Record<string, HTMLDivElement>>({})
  const nameOverlayRefs = useRef<Record<string, HTMLDivElement>>({})
  const codeEditorRefs = useRef<Record<string, HTMLDivElement>>({})
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const emitTagSelection = useTagSelection(blockId, subBlockId)

  // State for code editor dropdowns (per field)
  const [codeEditorDropdownState, setCodeEditorDropdownState] = useState<
    Record<
      string,
      {
        showTags: boolean
        showEnvVars: boolean
        searchTerm: string
        cursorPosition: number
        activeSourceBlockId: string | null
      }
    >
  >({})

  /**
   * Determines whether a `<...>` segment should be highlighted as a reference.
   */
  const shouldHighlightReference = (part: string): boolean => {
    if (!part.startsWith('<') || !part.endsWith('>')) {
      return false
    }

    if (!isLikelyReferenceSegment(part)) {
      return false
    }

    const split = splitReferenceSegment(part)
    if (!split) {
      return false
    }

    const reference = split.reference

    if (!accessiblePrefixes) {
      return true
    }

    const inner = reference.slice(1, -1)
    const [prefix] = inner.split('.')
    const normalizedPrefix = normalizeName(prefix)

    if (SYSTEM_REFERENCE_PREFIXES.has(normalizedPrefix)) {
      return true
    }

    return accessiblePrefixes.has(normalizedPrefix)
  }

  const highlightCode = createHighlightFunction(shouldHighlightReference)

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
          className={cn('allow-scroll w-full overflow-auto', inputClassName)}
          style={{ overflowX: 'auto' }}
        />
        <div
          ref={(el) => {
            if (el) nameOverlayRefs.current[field.id] = el
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
        {field.name && showType && <Badge size='sm'>{field.type}</Badge>}
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

    // Code editor types with tag support
    if (field.type === 'object' || field.type === 'array' || field.type === 'files') {
      const lineCount = fieldValue.split('\n').length
      const gutterWidth = calculateGutterWidth(lineCount)
      const editorFieldKey = `code-${field.id}`
      const dropdownState = codeEditorDropdownState[editorFieldKey] || {
        showTags: false,
        showEnvVars: false,
        searchTerm: '',
        cursorPosition: 0,
        activeSourceBlockId: null,
      }

      const placeholders: Record<string, string> = {
        object: '{\n  "key": "value"\n}',
        array: '[\n  1, 2, 3\n]',
        files:
          '[\n  {\n    "data": "<base64>",\n    "type": "file",\n    "name": "document.pdf",\n    "mime": "application/pdf"\n  }\n]',
      }

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

      const handleCodeChange = (newValue: string) => {
        if (isReadOnly) return
        updateField(field.id, 'value', newValue)

        const editorContainer = codeEditorRefs.current[editorFieldKey]
        const textarea = editorContainer?.querySelector('textarea')
        if (textarea) {
          const pos = textarea.selectionStart
          const tagTrigger = checkTagTrigger(newValue, pos)
          const envVarTrigger = checkEnvVarTrigger(newValue, pos)

          setCodeEditorDropdownState((prev) => ({
            ...prev,
            [editorFieldKey]: {
              showTags: tagTrigger.show,
              showEnvVars: envVarTrigger.show,
              searchTerm: envVarTrigger.show ? envVarTrigger.searchTerm : '',
              cursorPosition: pos,
              activeSourceBlockId: tagTrigger.show ? dropdownState.activeSourceBlockId : null,
            },
          }))
        }
      }

      const handleTagSelect = (newValue: string) => {
        if (!isReadOnly) {
          updateField(field.id, 'value', newValue)
          emitTagSelection(newValue)
        }
        setCodeEditorDropdownState((prev) => ({
          ...prev,
          [editorFieldKey]: {
            ...dropdownState,
            showTags: false,
            activeSourceBlockId: null,
          },
        }))
        setTimeout(() => {
          codeEditorRefs.current[editorFieldKey]?.querySelector('textarea')?.focus()
        }, 0)
      }

      const handleEnvVarSelect = (newValue: string) => {
        if (!isReadOnly) {
          updateField(field.id, 'value', newValue)
          emitTagSelection(newValue)
        }
        setCodeEditorDropdownState((prev) => ({
          ...prev,
          [editorFieldKey]: {
            ...dropdownState,
            showEnvVars: false,
            searchTerm: '',
          },
        }))
        setTimeout(() => {
          codeEditorRefs.current[editorFieldKey]?.querySelector('textarea')?.focus()
        }, 0)
      }

      const handleDrop = (e: React.DragEvent) => {
        if (isReadOnly) return
        e.preventDefault()
        try {
          const data = JSON.parse(e.dataTransfer.getData('application/json'))
          if (data.type !== 'connectionBlock') return

          const textarea = codeEditorRefs.current[editorFieldKey]?.querySelector('textarea')
          const dropPosition = textarea?.selectionStart ?? fieldValue.length
          const newValue = `${fieldValue.slice(0, dropPosition)}<${fieldValue.slice(dropPosition)}`

          updateField(field.id, 'value', newValue)
          const newCursorPosition = dropPosition + 1

          setTimeout(() => {
            if (textarea) {
              textarea.focus()
              textarea.selectionStart = newCursorPosition
              textarea.selectionEnd = newCursorPosition

              setCodeEditorDropdownState((prev) => ({
                ...prev,
                [editorFieldKey]: {
                  showTags: true,
                  showEnvVars: false,
                  searchTerm: '',
                  cursorPosition: newCursorPosition,
                  activeSourceBlockId: data.connectionData?.sourceBlockId || null,
                },
              }))
            }
          }, 0)
        } catch {
          // Ignore drop errors
        }
      }

      return (
        <div
          ref={(el) => {
            if (el) codeEditorRefs.current[editorFieldKey] = el
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <Code.Container className='min-h-[120px]'>
            <Code.Gutter width={gutterWidth}>{renderLineNumbers()}</Code.Gutter>
            <Code.Content paddingLeft={`${gutterWidth}px`}>
              <Code.Placeholder gutterWidth={gutterWidth} show={fieldValue.length === 0}>
                {placeholders[field.type]}
              </Code.Placeholder>
              <Editor
                value={fieldValue}
                onValueChange={handleCodeChange}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setCodeEditorDropdownState((prev) => ({
                      ...prev,
                      [editorFieldKey]: {
                        ...dropdownState,
                        showTags: false,
                        showEnvVars: false,
                      },
                    }))
                  }
                }}
                highlight={highlightCode}
                disabled={isReadOnly}
                {...getCodeEditorProps({ disabled: isReadOnly })}
              />
              {dropdownState.showEnvVars && !isReadOnly && (
                <EnvVarDropdown
                  visible={dropdownState.showEnvVars}
                  onSelect={handleEnvVarSelect}
                  searchTerm={dropdownState.searchTerm}
                  inputValue={fieldValue}
                  cursorPosition={dropdownState.cursorPosition}
                  workspaceId={workspaceId}
                  onClose={() => {
                    setCodeEditorDropdownState((prev) => ({
                      ...prev,
                      [editorFieldKey]: {
                        ...dropdownState,
                        showEnvVars: false,
                        searchTerm: '',
                      },
                    }))
                  }}
                  inputRef={{
                    current: codeEditorRefs.current[editorFieldKey]?.querySelector(
                      'textarea'
                    ) as HTMLTextAreaElement,
                  }}
                />
              )}
              {dropdownState.showTags && !isReadOnly && (
                <TagDropdown
                  visible={dropdownState.showTags}
                  onSelect={handleTagSelect}
                  blockId={blockId}
                  activeSourceBlockId={dropdownState.activeSourceBlockId}
                  inputValue={fieldValue}
                  cursorPosition={dropdownState.cursorPosition}
                  onClose={() => {
                    setCodeEditorDropdownState((prev) => ({
                      ...prev,
                      [editorFieldKey]: {
                        ...dropdownState,
                        showTags: false,
                        activeSourceBlockId: null,
                      },
                    }))
                  }}
                  inputRef={{
                    current: codeEditorRefs.current[editorFieldKey]?.querySelector(
                      'textarea'
                    ) as HTMLTextAreaElement,
                  }}
                />
              )}
            </Code.Content>
          </Code.Container>
        </div>
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
