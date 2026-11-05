'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'

/** Mirror the native form's reset into the picker's selection while its popup is portaled. */
export function usePickerValue<Option>(
  options: readonly Option[],
  getValue: (option: Option) => string,
  defaultValue?: string
) {
  const initial = options.find((option) => getValue(option) === defaultValue) ?? options[0]
  const initialValue = initial === undefined ? null : getValue(initial)
  const [selected, setValue] = useState(initialValue)
  const value = options.some((option) => getValue(option) === selected) ? selected : initialValue
  if (value !== selected) setValue(value)
  const [form, setForm] = useState<HTMLFormElement | null>(null)
  const { trigger: locate, container } = usePopoverContainer()
  const trigger = useCallback(
    (node: HTMLButtonElement | null) => {
      locate(node)
      setForm(node?.form ?? null)
    },
    [locate]
  )
  useEffect(() => {
    if (!form) return
    const reset = (event: Event) =>
      queueMicrotask(() => {
        if (!event.defaultPrevented) setValue(initialValue)
      })
    form.addEventListener('reset', reset)
    return () => form.removeEventListener('reset', reset)
  }, [form, initialValue])
  return { value, setValue, trigger, container }
}
