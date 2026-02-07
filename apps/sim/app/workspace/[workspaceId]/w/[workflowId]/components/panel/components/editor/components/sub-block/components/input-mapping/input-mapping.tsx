import { useMemo, useRef, useState } from 'react'
import { Badge, Input } from '@/components/emcn'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/core/utils/cn'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWorkflowState } from '@/hooks/queries/workflows'

/**
 * Props for the InputMappingField component
 */
interface InputMappingFieldProps {
  fieldName: string
  fieldType?: string
  value: string
  onChange: (value: string) => void
  blockId: string
  disabled: boolean
  accessiblePrefixes: Set<string> | undefined
  inputController: ReturnType<typeof useSubBlockInput>
  inputRefs: React.RefObject<Map<string, HTMLInputElement>>
  overlayRefs: React.RefObject<Map<string, HTMLDivElement>>
  collapsed: boolean
  onToggleCollapse: () => void
}

/**
 * Props for the InputMapping component
 */
interface InputMappingProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: Record<string, unknown>
  disabled?: boolean
  /** Sub-block values from the preview context for resolving sibling sub-block values */
  previewContextValues?: Record<string, unknown>
}

/**
 * InputMapping component displays and manages input field mappings for workflow execution
 * @param props - The component props
 * @returns The rendered InputMapping component
 */
export function InputMapping({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  previewContextValues,
}: InputMappingProps) {
  const [mapping, setMapping] = useSubBlockValue(blockId, subBlockId)
  const [storeWorkflowId] = useSubBlockValue(blockId, 'workflowId')
  const selectedWorkflowId = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.workflowId)
    : storeWorkflowId

  const inputController = useSubBlockInput({
    blockId,
    subBlockId,
    config: {
      id: subBlockId,
      type: 'input-mapping',
      connectionDroppable: true,
    },
    isPreview,
    disabled,
  })

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const overlayRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const workflowId = typeof selectedWorkflowId === 'string' ? selectedWorkflowId : undefined
  const { data: workflowState, isLoading } = useWorkflowState(workflowId)
  const childInputFields = useMemo(
    () => (workflowState?.blocks ? extractInputFieldsFromBlocks(workflowState.blocks) : []),
    [workflowState?.blocks]
  )
  const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})

  const valueObj: Record<string, string> = useMemo(() => {
    if (isPreview && previewValue && typeof previewValue === 'object') {
      return previewValue as Record<string, string>
    }
    if (mapping && typeof mapping === 'object') {
      return mapping as Record<string, string>
    }
    try {
      if (typeof mapping === 'string') {
        return JSON.parse(mapping)
      }
    } catch {
      // Invalid JSON, return empty object
    }
    return {}
  }, [mapping, isPreview, previewValue])

  const handleFieldUpdate = (field: string, value: string) => {
    if (disabled) return
    const updated = { ...valueObj, [field]: value }
    setMapping(updated)
  }

  const toggleCollapse = (fieldName: string) => {
    setCollapsedFields((prev) => ({
      ...prev,
      [fieldName]: !prev[fieldName],
    }))
  }

  if (!selectedWorkflowId) {
    return (
      <div className='flex h-32 items-center justify-center rounded-[4px] border border-[var(--border-1)] border-dashed bg-[var(--surface-3)] dark:bg-[#1F1F1F]'>
        <div className='text-center'>
          <p className='font-medium text-[var(--text-secondary)] text-sm'>No workflow selected</p>
          <p className='mt-1 text-[var(--text-muted)] text-xs'>
            Select a workflow above to configure inputs
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='space-y-[8px]'>
        <InputMappingField
          key='loading'
          fieldName='loading...'
          value=''
          onChange={() => {}}
          blockId={blockId}
          disabled={true}
          accessiblePrefixes={accessiblePrefixes}
          inputController={inputController}
          inputRefs={inputRefs}
          overlayRefs={overlayRefs}
          collapsed={false}
          onToggleCollapse={() => {}}
        />
      </div>
    )
  }

  if (!childInputFields || childInputFields.length === 0) {
    return <p className='text-[var(--text-muted)] text-sm'>No inputs available</p>
  }

  return (
    <div className='space-y-[8px]'>
      {childInputFields.map((field) => (
        <InputMappingField
          key={field.name}
          fieldName={field.name}
          fieldType={field.type}
          value={valueObj[field.name] || ''}
          onChange={(value) => handleFieldUpdate(field.name, value)}
          blockId={blockId}
          disabled={isPreview || disabled}
          accessiblePrefixes={accessiblePrefixes}
          inputController={inputController}
          inputRefs={inputRefs}
          overlayRefs={overlayRefs}
          collapsed={collapsedFields[field.name] || false}
          onToggleCollapse={() => toggleCollapse(field.name)}
        />
      ))}
    </div>
  )
}

/**
 * InputMappingField component renders an individual input field with tag dropdown support
 * @param props - The component props
 * @returns The rendered InputMappingField component
 */
function InputMappingField({
  fieldName,
  fieldType,
  value,
  onChange,
  blockId,
  disabled,
  accessiblePrefixes,
  inputController,
  inputRefs,
  overlayRefs,
  collapsed,
  onToggleCollapse,
}: InputMappingFieldProps) {
  const fieldId = fieldName
  const fieldState = inputController.fieldHelpers.getFieldState(fieldId)
  const handlers = inputController.fieldHelpers.createFieldHandlers(fieldId, value, onChange)
  const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
    fieldId,
    value,
    onChange
  )

  /**
   * Synchronizes scroll position between input and overlay
   * @param e - The scroll event
   */
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    const overlay = overlayRefs.current.get(fieldId)
    if (overlay) {
      overlay.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  return (
    <div
      className={cn(
        'rounded-[4px] border border-[var(--border-1)]',
        collapsed ? 'overflow-hidden' : 'overflow-visible'
      )}
    >
      <div
        className='flex cursor-pointer items-center justify-between rounded-t-[4px] bg-[var(--surface-4)] px-[10px] py-[5px]'
        onClick={onToggleCollapse}
      >
        <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
          <span className='block truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
            {fieldName}
          </span>
          {fieldType && (
            <Badge variant='type' size='sm'>
              {fieldType}
            </Badge>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className='flex flex-col gap-[8px] border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
          <div className='flex flex-col gap-[6px]'>
            <Label className='text-[13px]'>Value</Label>
            <div className='relative'>
              <Input
                ref={(el) => {
                  if (el) inputRefs.current.set(fieldId, el)
                }}
                name='value'
                value={value}
                onChange={handlers.onChange}
                onKeyDown={handlers.onKeyDown}
                onDrop={handlers.onDrop}
                onDragOver={handlers.onDragOver}
                onFocus={handlers.onFocus}
                onScroll={(e) => handleScroll(e)}
                onPaste={() =>
                  setTimeout(() => {
                    const input = inputRefs.current.get(fieldId)
                    input && handleScroll({ currentTarget: input } as any)
                  }, 0)
                }
                placeholder='Enter value or reference'
                disabled={disabled}
                autoComplete='off'
                className={cn(
                  'allow-scroll w-full overflow-auto text-transparent caret-foreground'
                )}
                style={{ overflowX: 'auto' }}
              />
              <div
                ref={(el) => {
                  if (el) overlayRefs.current.set(fieldId, el)
                }}
                className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-sm'
                style={{ overflowX: 'auto' }}
              >
                <div
                  className='w-full whitespace-pre'
                  style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
                >
                  {formatDisplayText(
                    value,
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
                  inputValue={value}
                  cursorPosition={fieldState.cursorPosition}
                  onClose={() => inputController.fieldHelpers.hideFieldDropdowns(fieldId)}
                  inputRef={
                    {
                      current: inputRefs.current.get(fieldId) || null,
                    } as React.RefObject<HTMLInputElement>
                  }
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
