'use client'

import { useEffect } from 'react'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/slider-input/slider-input.module.css'
import { useSubBlockValue } from '@/platform/lib/data/workflow-editor'

interface SliderInputProps {
  blockId: string
  subBlockId: string
  /** Names the slider for assistive technology. */
  label: string
  min?: number
  max?: number
  defaultValue?: number
  step?: number
  integer?: boolean
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

/** A bounded number on a range track, with its value read out beside it. */
export function SliderInput({
  blockId,
  subBlockId,
  label,
  min = 0,
  max = 100,
  defaultValue,
  step = 0.1,
  integer = false,
  isPreview = false,
  previewValue,
  disabled = false,
}: SliderInputProps) {
  const computedDefaultValue = defaultValue ?? (max <= 1 ? 0.7 : (min + max) / 2)
  const [storeValue, setStoreValue] = useSubBlockValue<number>(blockId, subBlockId)
  const raw = isPreview ? previewValue : storeValue
  const value = typeof raw === 'number' ? raw : raw == null || raw === '' ? null : Number(raw)
  const normalizedValue =
    value !== null && Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : computedDefaultValue

  useEffect(() => {
    if (!isPreview && value !== null && Number.isFinite(value) && value !== normalizedValue) {
      setStoreValue(normalizedValue)
    }
  }, [normalizedValue, value, setStoreValue, isPreview])

  const isDisabled = isPreview || disabled
  return (
    <div className={styles.row} data-disabled={isDisabled || undefined}>
      <input
        type='range'
        className={styles.range}
        aria-label={label}
        min={min}
        max={max}
        step={integer ? 1 : step}
        value={normalizedValue}
        disabled={isDisabled}
        onChange={(event) => {
          if (isDisabled) return
          const next = Number(event.target.value)
          setStoreValue(integer ? Math.round(next) : next)
        }}
      />
      <output className={styles.value} data-type='T060' aria-hidden='true'>
        {integer ? Math.round(normalizedValue).toString() : Number(normalizedValue).toFixed(1)}
      </output>
    </div>
  )
}
