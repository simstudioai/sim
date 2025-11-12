import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/emcn/components/input/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'

/**
 * Represents a field in the input format configuration
 */
interface InputFormatField {
  name: string
  type?: string
}

/**
 * Represents an input trigger block structure
 */
interface InputTriggerBlock {
  type: 'input_trigger' | 'start_trigger'
  subBlocks?: {
    inputFormat?: { value?: InputFormatField[] }
  }
}

/**
 * Represents a legacy starter block structure
 */
interface StarterBlockLegacy {
  type: 'starter'
  subBlocks?: {
    inputFormat?: { value?: InputFormatField[] }
  }
  config?: {
    params?: {
      inputFormat?: InputFormatField[]
    }
  }
}

/**
 * Props for the InputMappingField component
 */
interface InputMappingFieldProps {
  fieldName: string
  fieldType?: string
  value: string
  onChange: (value: string) => void
  blockId: string
  subBlockId: string
  disabled: boolean
  accessiblePrefixes: Set<string> | undefined
  inputController: ReturnType<typeof useSubBlockInput>
  inputRefs: React.MutableRefObject<Map<string, HTMLInputElement>>
  overlayRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
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
}

/**
 * Type guard to check if a value is an InputTriggerBlock
 * @param value - The value to check
 * @returns True if the value is an InputTriggerBlock
 */
function isInputTriggerBlock(value: unknown): value is InputTriggerBlock {
  const type = (value as { type?: unknown }).type
  return (
    !!value && typeof value === 'object' && (type === 'input_trigger' || type === 'start_trigger')
  )
}

/**
 * Type guard to check if a value is a StarterBlockLegacy
 * @param value - The value to check
 * @returns True if the value is a StarterBlockLegacy
 */
function isStarterBlock(value: unknown): value is StarterBlockLegacy {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'starter'
}

/**
 * Type guard to check if a value is an InputFormatField
 * @param value - The value to check
 * @returns True if the value is an InputFormatField
 */
function isInputFormatField(value: unknown): value is InputFormatField {
  if (typeof value !== 'object' || value === null) return false
  if (!('name' in value)) return false
  const { name, type } = value as { name: unknown; type?: unknown }
  if (typeof name !== 'string' || name.trim() === '') return false
  if (type !== undefined && typeof type !== 'string') return false
  return true
}

/**
 * Extracts input format fields from workflow blocks
 * @param blocks - The workflow blocks to extract from
 * @returns Array of input format fields or null if not found
 */
function extractInputFormatFields(blocks: Record<string, unknown>): InputFormatField[] | null {
  const triggerEntry = Object.entries(blocks).find(([, b]) => isInputTriggerBlock(b))
  if (triggerEntry && isInputTriggerBlock(triggerEntry[1])) {
    const inputFormat = triggerEntry[1].subBlocks?.inputFormat?.value
    if (Array.isArray(inputFormat)) {
      return (inputFormat as unknown[])
        .filter(isInputFormatField)
        .map((f) => ({ name: f.name, type: f.type }))
    }
  }

  const starterEntry = Object.entries(blocks).find(([, b]) => isStarterBlock(b))
  if (starterEntry && isStarterBlock(starterEntry[1])) {
    const starter = starterEntry[1]
    const subBlockFormat = starter.subBlocks?.inputFormat?.value
    const legacyParamsFormat = starter.config?.params?.inputFormat
    const chosen = Array.isArray(subBlockFormat) ? subBlockFormat : legacyParamsFormat
    if (Array.isArray(chosen)) {
      return (chosen as unknown[])
        .filter(isInputFormatField)
        .map((f) => ({ name: f.name, type: f.type }))
    }
  }

  return null
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
}: InputMappingProps) {
  const [mapping, setMapping] = useSubBlockValue(blockId, subBlockId)
  const [selectedWorkflowId] = useSubBlockValue(blockId, 'workflowId')

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

  const [childInputFields, setChildInputFields] = useState<InputFormatField[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let isMounted = true
    const controller = new AbortController()

    async function fetchChildSchema() {
      if (!selectedWorkflowId) {
        if (isMounted) {
          setChildInputFields([])
          setIsLoading(false)
        }
        return
      }

      try {
        if (isMounted) setIsLoading(true)

        const res = await fetch(`/api/workflows/${selectedWorkflowId}`, {
          signal: controller.signal,
        })

        if (!res.ok) {
          if (isMounted) {
            setChildInputFields([])
            setIsLoading(false)
          }
          return
        }

        const { data } = await res.json()
        const blocks = (data?.state?.blocks as Record<string, unknown>) || {}
        const fields = extractInputFormatFields(blocks)

        if (isMounted) {
          setChildInputFields(fields || [])
          setIsLoading(false)
        }
      } catch (error) {
        if (isMounted) {
          setChildInputFields([])
          setIsLoading(false)
        }
      }
    }

    fetchChildSchema()

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [selectedWorkflowId])

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

  if (!selectedWorkflowId) {
    return (
      <div className='flex flex-col items-center justify-center rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F] p-8 text-center'>
        <svg
          className='mb-3 h-10 w-10 text-[var(--text-tertiary)]'
          fill='none'
          viewBox='0 0 24 24'
          stroke='currentColor'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={1.5}
            d='M13 10V3L4 14h7v7l9-11h-7z'
          />
        </svg>
        <p className='font-medium text-[var(--text-tertiary)] text-sm'>No workflow selected</p>
        <p className='mt-1 text-[var(--text-tertiary)]/80 text-xs'>
          Select a workflow above to configure inputs
        </p>
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
          subBlockId={subBlockId}
          disabled={true}
          accessiblePrefixes={accessiblePrefixes}
          inputController={inputController}
          inputRefs={inputRefs}
          overlayRefs={overlayRefs}
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
          subBlockId={subBlockId}
          disabled={isPreview || disabled}
          accessiblePrefixes={accessiblePrefixes}
          inputController={inputController}
          inputRefs={inputRefs}
          overlayRefs={overlayRefs}
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
  subBlockId,
  disabled,
  accessiblePrefixes,
  inputController,
  inputRefs,
  overlayRefs,
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
    <div className='group relative overflow-visible rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F]'>
      <div className='flex items-center justify-between bg-transparent px-[10px] py-[5px]'>
        <Label className='font-medium text-[14px] text-[var(--text-tertiary)]'>{fieldName}</Label>
        {fieldType && (
          <span className='rounded-md bg-[#2A2A2A] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)]'>
            {fieldType}
          </span>
        )}
      </div>
      <div className='relative w-full border-[var(--border-strong)] border-t bg-transparent'>
        <Input
          ref={(el) => {
            if (el) inputRefs.current.set(fieldId, el)
          }}
          className={cn(
            'allow-scroll !bg-transparent w-full overflow-auto rounded-none border-0 px-[10px] py-[8px] text-transparent caret-white [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden'
          )}
          type='text'
          value={value}
          onChange={handlers.onChange}
          onKeyDown={handlers.onKeyDown}
          onScroll={handleScroll}
          onDrop={handlers.onDrop}
          onDragOver={handlers.onDragOver}
          autoComplete='off'
          disabled={disabled}
        />
        <div
          ref={(el) => {
            if (el) overlayRefs.current.set(fieldId, el)
          }}
          className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[10px] py-[8px] font-medium font-sans text-[#eeeeee] text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        >
          <div className='min-w-fit whitespace-pre'>
            {formatDisplayText(value, {
              accessiblePrefixes,
              highlightAll: !accessiblePrefixes,
            })}
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
  )
}
