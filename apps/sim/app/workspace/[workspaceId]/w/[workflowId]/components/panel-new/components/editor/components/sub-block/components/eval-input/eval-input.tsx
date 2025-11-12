import { useMemo, useRef } from 'react'
import { Plus } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/emcn/components/button/button'
import { Input } from '@/components/emcn/components/input/input'
import { Textarea } from '@/components/emcn/components/textarea/textarea'
import { Trash } from '@/components/emcn/icons/trash'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'

interface EvalMetric {
  id: string
  name: string
  description: string
  range: {
    min: number
    max: number
  }
}

interface EvalInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: EvalMetric[] | null
  disabled?: boolean
}

// Default values
const createDefaultMetric = (): EvalMetric => ({
  id: crypto.randomUUID(),
  name: '',
  description: '',
  range: { min: 0, max: 1 },
})

export function EvalInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: EvalInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<EvalMetric[]>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const descriptionInputRefs = useRef<Record<string, HTMLTextAreaElement>>({})
  const descriptionOverlayRefs = useRef<Record<string, HTMLDivElement>>({})

  // Use the extended hook for field-level management
  const inputController = useSubBlockInput({
    blockId,
    subBlockId,
    config: {
      id: subBlockId,
      type: 'eval-input',
      connectionDroppable: true,
    },
    isPreview,
    disabled,
  })

  const value = isPreview ? previewValue : storeValue

  const defaultMetric = useMemo(() => createDefaultMetric(), [])
  const metrics: EvalMetric[] = value || [defaultMetric]

  const addMetric = () => {
    if (isPreview || disabled) return

    const newMetric: EvalMetric = createDefaultMetric()
    setStoreValue([...metrics, newMetric])
  }

  const removeMetric = (id: string) => {
    if (isPreview || disabled || metrics.length === 1) return
    setStoreValue(metrics.filter((metric) => metric.id !== id))
  }

  const updateMetric = (id: string, field: keyof EvalMetric, value: any) => {
    if (isPreview || disabled) return
    setStoreValue(
      metrics.map((metric) => (metric.id === id ? { ...metric, [field]: value } : metric))
    )
  }

  const updateRange = (id: string, field: 'min' | 'max', value: string) => {
    if (isPreview || disabled) return
    setStoreValue(
      metrics.map((metric) =>
        metric.id === id
          ? {
              ...metric,
              range: {
                ...metric.range,
                [field]: value === '' ? undefined : Number.parseInt(value, 10),
              },
            }
          : metric
      )
    )
  }

  const handleRangeBlur = (id: string, field: 'min' | 'max', value: string) => {
    const sanitizedValue = value.replace(/[^\d.-]/g, '')
    const numValue = Number.parseFloat(sanitizedValue)

    setStoreValue(
      metrics.map((metric) =>
        metric.id === id
          ? {
              ...metric,
              range: {
                ...metric.range,
                [field]: !Number.isNaN(numValue) ? numValue : 0,
              },
            }
          : metric
      )
    )
  }

  // Helper to update a metric field
  const updateMetricField = (metricId: string, newDescription: string) => {
    updateMetric(metricId, 'description', newDescription)
  }

  const renderMetricHeader = (metric: EvalMetric, index: number) => (
    <div className='flex items-center justify-between overflow-hidden rounded-t-[4px] border-[var(--border-strong)] border-b bg-transparent px-[10px] py-[5px]'>
      <span className='font-medium text-[14px] text-[var(--text-tertiary)]'>
        Metric {index + 1}
      </span>
      <div className='flex items-center gap-[8px]'>
        <Tooltip.Root key={`add-${metric.id}`}>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={addMetric}
              disabled={isPreview || disabled}
              className='h-auto p-0'
            >
              <Plus className='h-[14px] w-[14px]' />
              <span className='sr-only'>Add Metric</span>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Add Metric</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root key={`remove-${metric.id}`}>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={() => removeMetric(metric.id)}
              disabled={isPreview || disabled || metrics.length === 1}
              className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
            >
              <Trash className='h-[14px] w-[14px]' />
              <span className='sr-only'>Delete Metric</span>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Delete Metric</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>
  )

  return (
    <div className='space-y-[8px]'>
      {metrics.map((metric, index) => (
        <div
          key={metric.id}
          data-metric-id={metric.id}
          className='group relative overflow-visible rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F]'
        >
          {renderMetricHeader(metric, index)}

          <div className='flex flex-col gap-[6px] border-[var(--border-strong)] px-[10px] pt-[6px] pb-[10px]'>
            <div key={`name-${metric.id}`} className='space-y-[4px]'>
              <Label className='text-[13px]'>Name</Label>
              <Input
                name='name'
                value={metric.name}
                onChange={(e) => updateMetric(metric.id, 'name', e.target.value)}
                placeholder='Accuracy'
                disabled={isPreview || disabled}
              />
            </div>

            <div key={`description-${metric.id}`} className='space-y-[4px]'>
              <Label className='text-[13px]'>Description</Label>
              <div className='relative'>
                {(() => {
                  const fieldState = inputController.fieldHelpers.getFieldState(metric.id)
                  const handlers = inputController.fieldHelpers.createFieldHandlers(
                    metric.id,
                    metric.description || '',
                    (newValue) => updateMetricField(metric.id, newValue)
                  )
                  const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
                    metric.id,
                    metric.description || '',
                    (newValue) => updateMetricField(metric.id, newValue)
                  )

                  return (
                    <>
                      <Textarea
                        ref={(el) => {
                          if (el) descriptionInputRefs.current[metric.id] = el
                        }}
                        value={metric.description}
                        onChange={handlers.onChange}
                        onKeyDown={handlers.onKeyDown}
                        onDrop={handlers.onDrop}
                        onDragOver={handlers.onDragOver}
                        placeholder='How accurate is the response?'
                        disabled={isPreview || disabled}
                        className={cn(
                          'min-h-[80px] whitespace-pre-wrap text-transparent caret-white'
                        )}
                        rows={3}
                      />
                      <div
                        ref={(el) => {
                          if (el) descriptionOverlayRefs.current[metric.id] = el
                        }}
                        className='pointer-events-none absolute inset-0 overflow-auto bg-transparent px-[8px] py-[8px] font-medium font-sans text-[#eeeeee] text-sm'
                      >
                        <div className='whitespace-pre-wrap'>
                          {formatDisplayText(metric.description || '', {
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
                          inputValue={metric.description || ''}
                          cursorPosition={fieldState.cursorPosition}
                          onClose={() => inputController.fieldHelpers.hideFieldDropdowns(metric.id)}
                          inputRef={{
                            current: descriptionInputRefs.current[metric.id] || null,
                          }}
                        />
                      )}
                    </>
                  )
                })()}
              </div>
            </div>

            <div key={`range-${metric.id}`} className='grid grid-cols-2 gap-[6px]'>
              <div className='space-y-[4px]'>
                <Label className='text-[13px]'>Min Value</Label>
                <Input
                  type='text'
                  value={metric.range.min}
                  onChange={(e) => updateRange(metric.id, 'min', e.target.value)}
                  onBlur={(e) => handleRangeBlur(metric.id, 'min', e.target.value)}
                  disabled={isPreview || disabled}
                  autoComplete='off'
                  data-form-type='other'
                  name='eval-range-min'
                />
              </div>
              <div className='space-y-[4px]'>
                <Label className='text-[13px]'>Max Value</Label>
                <Input
                  type='text'
                  value={metric.range.max}
                  onChange={(e) => updateRange(metric.id, 'max', e.target.value)}
                  onBlur={(e) => handleRangeBlur(metric.id, 'max', e.target.value)}
                  disabled={isPreview || disabled}
                  autoComplete='off'
                  data-form-type='other'
                  name='eval-range-max'
                />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
