'use client'

import { useRef } from 'react'
import { IconButton } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { generateId } from '@sim/utils/id'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/eval-input/eval-input.module.css'
import { FieldLabelRow } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/field-label-row/field-label-row'
import { LongInput } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/long-input/long-input'
import { ShortInput } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/short-input/short-input'
import { useSubBlockValue } from '@/platform/lib/data/workflow-editor'

/** One metric an Evaluator block scores, as the sub-block stores it. */
interface EvalMetric {
  id: string
  name: string
  description: string
  /** Typing an unparseable bound stores it empty until the field is left. */
  range?: { min?: number | null; max?: number | null }
}

type RangeBound = 'min' | 'max'

function createDefaultMetric(): EvalMetric {
  return { id: generateId(), name: '', description: '', range: { min: 0, max: 1 } }
}

function boundText(metric: EvalMetric, bound: RangeBound): string {
  const value = metric.range?.[bound]
  return value === undefined || value === null ? '' : String(value)
}

interface EvalInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

/**
 * An Evaluator block's metrics: each has a name, a description the model scores against (with
 * the `<` and `{{` pickers) and a min/max score range. Metrics can be added and deleted down to
 * one.
 */
export function EvalInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: EvalInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<EvalMetric[]>(blockId, subBlockId)
  const fallbackRef = useRef<EvalMetric | null>(null)
  const fallbackMetric = (fallbackRef.current ??= createDefaultMetric())

  const value = isPreview ? previewValue : storeValue
  const metrics: EvalMetric[] = Array.isArray(value) && value.length > 0 ? value : [fallbackMetric]
  const isLocked = isPreview || disabled

  const addMetric = () => {
    if (isLocked) return
    setStoreValue([...metrics, createDefaultMetric()])
  }

  const removeMetric = (id: string) => {
    if (isLocked || metrics.length === 1) return
    setStoreValue(metrics.filter((metric) => metric.id !== id))
  }

  const updateText = (id: string, field: 'name' | 'description', text: string) => {
    if (isLocked) return
    setStoreValue(
      metrics.map((metric) => (metric.id === id ? { ...metric, [field]: text } : metric))
    )
  }

  const updateBound = (id: string, bound: RangeBound, text: string) => {
    if (isLocked) return
    setStoreValue(
      metrics.map((metric) =>
        metric.id === id
          ? {
              ...metric,
              range: {
                ...metric.range,
                [bound]: text === '' ? undefined : Number.parseInt(text, 10),
              },
            }
          : metric
      )
    )
  }

  const settleBound = (id: string, bound: RangeBound, text: string) => {
    if (isLocked) return
    const parsed = Number.parseFloat(text.replace(/[^\d.-]/g, ''))
    setStoreValue(
      metrics.map((metric) =>
        metric.id === id
          ? {
              ...metric,
              range: { ...metric.range, [bound]: Number.isNaN(parsed) ? 0 : parsed },
            }
          : metric
      )
    )
  }

  return (
    <div className={styles.metrics}>
      {metrics.map((metric, index) => {
        const title = `Metric ${index + 1}`
        const minText = boundText(metric, 'min')
        const maxText = boundText(metric, 'max')
        return (
          <div key={metric.id} className={styles.metric}>
            <FieldLabelRow
              label={title}
              actions={
                !isPreview && (
                  <>
                    <IconButton
                      label='Add metric'
                      icon='I074'
                      size='compact'
                      tooltip
                      disabled={disabled}
                      onClick={addMetric}
                    />
                    <IconButton
                      label='Delete metric'
                      icon='I105'
                      size='compact'
                      tooltip
                      disabled={disabled || metrics.length === 1}
                      onClick={() => removeMetric(metric.id)}
                    />
                  </>
                )
              }
            />
            <FieldFrame label='Name'>
              <ShortInput
                blockId={blockId}
                subBlockId={subBlockId}
                config={{
                  id: `${subBlockId}-name`,
                  type: 'short-input',
                  title: `${title} name`,
                  connectionDroppable: false,
                }}
                placeholder='Accuracy'
                value={metric.name}
                previewValue={metric.name}
                onChange={(text) => updateText(metric.id, 'name', text)}
                isPreview={isPreview}
                disabled={disabled}
                allowReferences={false}
                workflowSearchValuePath={[index, 'name']}
              />
            </FieldFrame>
            <FieldFrame label='Description'>
              <LongInput
                blockId={blockId}
                subBlockId={subBlockId}
                config={{
                  id: `${subBlockId}-description`,
                  type: 'long-input',
                  title: `${title} description`,
                }}
                placeholder='How accurate is the response?'
                rows={3}
                value={metric.description}
                previewValue={metric.description}
                onChange={(text) => updateText(metric.id, 'description', text)}
                isPreview={isPreview}
                disabled={disabled}
                workflowSearchValuePath={[index, 'description']}
              />
            </FieldFrame>
            <div className={styles.range}>
              <FieldFrame label='Min Value'>
                <ShortInput
                  blockId={blockId}
                  subBlockId={subBlockId}
                  config={{
                    id: `${subBlockId}-range-min`,
                    type: 'short-input',
                    title: `${title} min value`,
                    connectionDroppable: false,
                  }}
                  value={minText}
                  previewValue={minText}
                  onChange={(text) => updateBound(metric.id, 'min', text)}
                  onBlur={() => settleBound(metric.id, 'min', minText)}
                  isPreview={isPreview}
                  disabled={disabled}
                  allowReferences={false}
                  workflowSearchValuePath={[index, 'range', 'min']}
                />
              </FieldFrame>
              <FieldFrame label='Max Value'>
                <ShortInput
                  blockId={blockId}
                  subBlockId={subBlockId}
                  config={{
                    id: `${subBlockId}-range-max`,
                    type: 'short-input',
                    title: `${title} max value`,
                    connectionDroppable: false,
                  }}
                  value={maxText}
                  previewValue={maxText}
                  onChange={(text) => updateBound(metric.id, 'max', text)}
                  onBlur={() => settleBound(metric.id, 'max', maxText)}
                  isPreview={isPreview}
                  disabled={disabled}
                  allowReferences={false}
                  workflowSearchValuePath={[index, 'range', 'max']}
                />
              </FieldFrame>
            </div>
          </div>
        )
      })}
    </div>
  )
}
