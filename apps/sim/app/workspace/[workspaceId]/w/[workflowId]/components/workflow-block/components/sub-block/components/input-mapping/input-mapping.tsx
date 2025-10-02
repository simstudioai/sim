import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface InputFormatField {
  name: string
  type?: string
}

interface InputTriggerBlock {
  type: 'input_trigger'
  subBlocks?: {
    inputFormat?: { value?: InputFormatField[] }
  }
}

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

function isInputTriggerBlock(value: unknown): value is InputTriggerBlock {
  return (
    !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'input_trigger'
  )
}

function isStarterBlock(value: unknown): value is StarterBlockLegacy {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'starter'
}

function isInputFormatField(value: unknown): value is InputFormatField {
  if (typeof value !== 'object' || value === null) return false
  if (!('name' in value)) return false
  const { name, type } = value as { name: unknown; type?: unknown }
  if (typeof name !== 'string' || name.trim() === '') return false
  if (type !== undefined && typeof type !== 'string') return false
  return true
}

interface InputMappingProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: any
  disabled?: boolean
}

// Simple mapping UI: for each field in child Input Trigger's inputFormat, render an input with TagDropdown support
export function InputMapping({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: InputMappingProps) {
  const [mapping, setMapping] = useSubBlockValue(blockId, subBlockId)
  const [selectedWorkflowId] = useSubBlockValue(blockId, 'workflowId')

  const { workflows } = useWorkflowRegistry.getState()

  // Fetch child workflow state via registry API endpoint, using cached metadata when possible
  // Here we rely on live store; the serializer/executor will resolve at runtime too.
  // We only need the inputFormat from an Input Trigger in the selected child workflow state.
  const [childInputFields, setChildInputFields] = useState<Array<{ name: string; type?: string }>>(
    []
  )

  useEffect(() => {
    let isMounted = true
    const controller = new AbortController()
    async function fetchChildSchema() {
      try {
        if (!selectedWorkflowId) {
          if (isMounted) setChildInputFields([])
          return
        }
        const res = await fetch(`/api/workflows/${selectedWorkflowId}`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          if (isMounted) setChildInputFields([])
          return
        }
        const { data } = await res.json()
        const blocks = (data?.state?.blocks as Record<string, unknown>) || {}
        // Prefer new input_trigger
        const triggerEntry = Object.entries(blocks).find(([, b]) => isInputTriggerBlock(b))
        if (triggerEntry && isInputTriggerBlock(triggerEntry[1])) {
          const inputFormat = triggerEntry[1].subBlocks?.inputFormat?.value
          if (Array.isArray(inputFormat)) {
            const fields = (inputFormat as unknown[])
              .filter(isInputFormatField)
              .map((f) => ({ name: f.name, type: f.type }))
            if (isMounted) setChildInputFields(fields)
            return
          }
        }

        // Fallback: legacy starter block inputFormat (subBlocks or config.params)
        const starterEntry = Object.entries(blocks).find(([, b]) => isStarterBlock(b))
        if (starterEntry && isStarterBlock(starterEntry[1])) {
          const starter = starterEntry[1]
          const subBlockFormat = starter.subBlocks?.inputFormat?.value
          const legacyParamsFormat = starter.config?.params?.inputFormat
          const chosen = Array.isArray(subBlockFormat) ? subBlockFormat : legacyParamsFormat
          if (Array.isArray(chosen)) {
            const fields = (chosen as unknown[])
              .filter(isInputFormatField)
              .map((f) => ({ name: f.name, type: f.type }))
            if (isMounted) setChildInputFields(fields)
            return
          }
        }

        if (isMounted) setChildInputFields([])
      } catch {
        if (isMounted) setChildInputFields([])
      }
    }
    fetchChildSchema()
    return () => {
      isMounted = false
      controller.abort()
    }
  }, [selectedWorkflowId])

  const valueObj: Record<string, any> = useMemo(() => {
    if (isPreview && previewValue && typeof previewValue === 'object') return previewValue
    if (mapping && typeof mapping === 'object') return mapping as Record<string, any>
    try {
      if (typeof mapping === 'string') return JSON.parse(mapping)
    } catch {}
    return {}
  }, [mapping, isPreview, previewValue])

  const update = (field: string, value: string) => {
    if (disabled) return
    const updated = { ...valueObj, [field]: value }
    setMapping(updated)
  }

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  if (!selectedWorkflowId) {
    return (
      <div className='flex flex-col items-center justify-center rounded-lg border border-border/50 bg-muted/30 p-8 text-center'>
        <svg
          className='mb-3 h-10 w-10 text-muted-foreground/60'
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
        <p className='font-medium text-muted-foreground text-sm'>No workflow selected</p>
        <p className='mt-1 text-muted-foreground/80 text-xs'>
          Select a workflow above to configure inputs
        </p>
      </div>
    )
  }

  if (!childInputFields || childInputFields.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center rounded-lg border border-border/50 bg-muted/30 p-8 text-center'>
        <svg
          className='mb-3 h-10 w-10 text-muted-foreground/60'
          fill='none'
          viewBox='0 0 24 24'
          stroke='currentColor'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth={1.5}
            d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
          />
        </svg>
        <p className='font-medium text-muted-foreground text-sm'>No input fields defined</p>
        <p className='mt-1 max-w-[200px] text-muted-foreground/80 text-xs'>
          The selected workflow needs an Input Trigger with defined fields
        </p>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {childInputFields.map((field) => {
        return (
          <InputMappingField
            key={field.name}
            fieldName={field.name}
            fieldType={field.type}
            value={valueObj[field.name] || ''}
            onChange={(value) => update(field.name, value)}
            blockId={blockId}
            subBlockId={subBlockId}
            disabled={isPreview || disabled}
            accessiblePrefixes={accessiblePrefixes}
          />
        )
      })}
    </div>
  )
}

// Individual field component with TagDropdown support
function InputMappingField({
  fieldName,
  fieldType,
  value,
  onChange,
  blockId,
  subBlockId,
  disabled,
  accessiblePrefixes,
}: {
  fieldName: string
  fieldType?: string
  value: string
  onChange: (value: string) => void
  blockId: string
  subBlockId: string
  disabled: boolean
  accessiblePrefixes: Set<string> | undefined
}) {
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      e.preventDefault()
      return
    }

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    onChange(newValue)
    setCursorPosition(newCursorPosition)

    // Check for tag trigger
    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

  // Sync scroll position between input and overlay
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowTags(false)
    }
  }

  const handleTagSelect = (newValue: string) => {
    onChange(newValue)
  }

  return (
    <div className='group relative rounded-lg border border-border/50 bg-background/50 p-3 transition-all hover:border-border hover:bg-background'>
      <div className='mb-2 flex items-center justify-between'>
        <Label className='font-medium text-foreground text-xs'>{fieldName}</Label>
        {fieldType && (
          <span className='rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'>
            {fieldType}
          </span>
        )}
      </div>
      <div className='relative w-full'>
        <Input
          ref={inputRef}
          className={cn(
            'allow-scroll h-9 w-full overflow-auto text-transparent caret-foreground placeholder:text-muted-foreground/50',
            'border border-input bg-white transition-colors duration-200 dark:border-input/60 dark:bg-background'
          )}
          type='text'
          value={value}
          onChange={handleChange}
          onFocus={() => {
            setShowTags(false)
          }}
          onBlur={() => {
            setShowTags(false)
          }}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          autoComplete='off'
          style={{ overflowX: 'auto' }}
          disabled={disabled}
        />
        <div
          ref={overlayRef}
          className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-3 text-sm'
          style={{ overflowX: 'auto' }}
        >
          <div
            className='w-full whitespace-pre'
            style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
          >
            {formatDisplayText(value, {
              accessiblePrefixes,
              highlightAll: !accessiblePrefixes,
            })}
          </div>
        </div>

        <TagDropdown
          visible={showTags}
          onSelect={handleTagSelect}
          blockId={blockId}
          activeSourceBlockId={null}
          inputValue={value}
          cursorPosition={cursorPosition}
          onClose={() => {
            setShowTags(false)
          }}
        />
      </div>
    </div>
  )
}
