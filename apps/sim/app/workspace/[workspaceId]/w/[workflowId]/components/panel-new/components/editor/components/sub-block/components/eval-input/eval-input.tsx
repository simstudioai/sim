import { useMemo, useRef, useState } from 'react'
import { Plus, Trash } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
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
  isConnecting?: boolean
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
  isConnecting = false,
}: EvalInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<EvalMetric[]>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [activeMetricId, setActiveMetricId] = useState<string | null>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const descriptionInputRefs = useRef<Record<string, HTMLTextAreaElement>>({})
  const descriptionOverlayRefs = useRef<Record<string, HTMLDivElement>>({})
  const [dragHighlight, setDragHighlight] = useState<Record<string, boolean>>({})

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

  const handleTagSelect = (tag: string) => {
    if (!activeMetricId) return

    const metric = metrics.find((m) => m.id === activeMetricId)
    if (!metric) return

    const currentValue = metric.description || ''
    const textBeforeCursor = currentValue.slice(0, cursorPosition)
    const lastOpenBracket = textBeforeCursor.lastIndexOf('<')

    const newValue =
      currentValue.slice(0, lastOpenBracket) + tag + currentValue.slice(cursorPosition)

    updateMetric(activeMetricId, 'description', newValue)
    setShowTags(false)

    setTimeout(() => {
      const inputEl = descriptionInputRefs.current[activeMetricId]
      if (inputEl) {
        inputEl.focus()
        const newCursorPos = lastOpenBracket + tag.length
        inputEl.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 10)
  }

  const handleDescriptionChange = (metricId: string, newValue: string, selectionStart?: number) => {
    updateMetric(metricId, 'description', newValue)

    if (selectionStart !== undefined) {
      setCursorPosition(selectionStart)
      setActiveMetricId(metricId)

      const shouldShowTags = checkTagTrigger(newValue, selectionStart)
      setShowTags(shouldShowTags.show)

      if (shouldShowTags.show) {
        const textBeforeCursor = newValue.slice(0, selectionStart)
        const lastOpenBracket = textBeforeCursor.lastIndexOf('<')
        const tagContent = textBeforeCursor.slice(lastOpenBracket + 1)
        const dotIndex = tagContent.indexOf('.')
        const sourceBlock = dotIndex > 0 ? tagContent.slice(0, dotIndex) : null
        setActiveSourceBlockId(sourceBlock)
      }
    }
  }

  const handleDrop = (e: React.DragEvent, metricId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [metricId]: false }))
    const input = descriptionInputRefs.current[metricId]
    input?.focus()

    if (input) {
      const metric = metrics.find((m) => m.id === metricId)
      const currentValue = metric?.description || ''
      const dropPosition = input.selectionStart ?? currentValue.length
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`
      updateMetric(metricId, 'description', newValue)
      setActiveMetricId(metricId)
      setCursorPosition(dropPosition + 1)
      setShowTags(true)

      try {
        const data = JSON.parse(e.dataTransfer.getData('application/json'))
        if (data?.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }
      } catch {}

      setTimeout(() => {
        const el = descriptionInputRefs.current[metricId]
        if (el) {
          el.selectionStart = dropPosition + 1
          el.selectionEnd = dropPosition + 1
        }
      }, 0)
    }
  }

  const handleDragOver = (e: React.DragEvent, metricId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragHighlight((prev) => ({ ...prev, [metricId]: true }))
  }

  const handleDragLeave = (e: React.DragEvent, metricId: string) => {
    e.preventDefault()
    setDragHighlight((prev) => ({ ...prev, [metricId]: false }))
  }

  const renderMetricHeader = (metric: EvalMetric, index: number) => (
    <div className='flex h-10 items-center justify-between rounded-t-lg border-b bg-card px-3'>
      <span className='font-medium text-sm'>Metric {index + 1}</span>
      <div className='flex items-center gap-1'>
        <Tooltip.Root key={`add-${metric.id}`}>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={addMetric}
              disabled={isPreview || disabled}
              className='h-8 w-8'
            >
              <Plus className='h-4 w-4' />
              <span className='sr-only'>Add Metric</span>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Add Metric</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root key={`remove-${metric.id}`}>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => removeMetric(metric.id)}
              disabled={isPreview || disabled || metrics.length === 1}
              className='h-8 w-8 text-destructive hover:text-destructive'
            >
              <Trash className='h-4 w-4' />
              <span className='sr-only'>Delete Metric</span>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Delete Metric</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </div>
  )

  return (
    <div className='space-y-2'>
      {metrics.map((metric, index) => (
        <div
          key={metric.id}
          data-metric-id={metric.id}
          className='group relative overflow-visible rounded-lg border bg-background'
        >
          {renderMetricHeader(metric, index)}

          <div className='space-y-2 px-3 pt-2 pb-3'>
            <div key={`name-${metric.id}`} className='space-y-1'>
              <Label>Name</Label>
              <Input
                name='name'
                value={metric.name}
                onChange={(e) => updateMetric(metric.id, 'name', e.target.value)}
                placeholder='Accuracy'
                disabled={isPreview || disabled}
                className='placeholder:text-muted-foreground/50'
              />
            </div>

            <div key={`description-${metric.id}`} className='space-y-1'>
              <Label>Description</Label>
              <div className='relative'>
                <Textarea
                  ref={(el) => {
                    if (el) descriptionInputRefs.current[metric.id] = el
                  }}
                  value={metric.description}
                  onChange={(e) =>
                    handleDescriptionChange(
                      metric.id,
                      e.target.value,
                      e.target.selectionStart ?? undefined
                    )
                  }
                  placeholder='How accurate is the response?'
                  disabled={isPreview || disabled}
                  className={cn(
                    'min-h-[80px] border border-input bg-white text-transparent caret-foreground placeholder:text-muted-foreground/50 dark:border-input/60 dark:bg-background',
                    (isConnecting || dragHighlight[metric.id]) &&
                      'ring-2 ring-blue-500 ring-offset-2'
                  )}
                  style={{
                    fontFamily: 'inherit',
                    lineHeight: 'inherit',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                  }}
                  rows={3}
                  onDrop={(e) => handleDrop(e, metric.id)}
                  onDragOver={(e) => handleDragOver(e, metric.id)}
                  onDragLeave={(e) => handleDragLeave(e, metric.id)}
                />
                <div
                  ref={(el) => {
                    if (el) descriptionOverlayRefs.current[metric.id] = el
                  }}
                  className='pointer-events-none absolute inset-0 flex items-start overflow-auto bg-transparent px-3 py-2 text-sm'
                  style={{
                    fontFamily: 'inherit',
                    lineHeight: 'inherit',
                  }}
                >
                  <div className='w-full whitespace-pre-wrap break-words'>
                    {formatDisplayText(metric.description || '', {
                      accessiblePrefixes,
                      highlightAll: !accessiblePrefixes,
                    })}
                  </div>
                </div>
                {showTags && activeMetricId === metric.id && (
                  <TagDropdown
                    visible={showTags}
                    onSelect={handleTagSelect}
                    blockId={blockId}
                    activeSourceBlockId={activeSourceBlockId}
                    inputValue={metric.description || ''}
                    cursorPosition={cursorPosition}
                    onClose={() => setShowTags(false)}
                    className='absolute top-full left-0 z-50 mt-1'
                  />
                )}
              </div>
            </div>

            <div key={`range-${metric.id}`} className='grid grid-cols-2 gap-4'>
              <div className='space-y-1'>
                <Label>Min Value</Label>
                <Input
                  type='text'
                  value={metric.range.min}
                  onChange={(e) => updateRange(metric.id, 'min', e.target.value)}
                  onBlur={(e) => handleRangeBlur(metric.id, 'min', e.target.value)}
                  disabled={isPreview || disabled}
                  className='placeholder:text-muted-foreground/50'
                  autoComplete='off'
                  data-form-type='other'
                  name='eval-range-min'
                />
              </div>
              <div className='space-y-1'>
                <Label>Max Value</Label>
                <Input
                  type='text'
                  value={metric.range.max}
                  onChange={(e) => updateRange(metric.id, 'max', e.target.value)}
                  onBlur={(e) => handleRangeBlur(metric.id, 'max', e.target.value)}
                  disabled={isPreview || disabled}
                  className='placeholder:text-muted-foreground/50'
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
