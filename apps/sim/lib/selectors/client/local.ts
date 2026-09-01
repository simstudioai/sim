'use client'

import type { LocalSelectorKey } from '@/lib/selectors/manifest'
import type { SelectorExecutionResult } from '@/lib/selectors/types'

type LocalSelectorAttachment = () => Promise<SelectorExecutionResult>

export const localSelectorAttachments = {
  'workspace.triggerTypes': async () => {
    const { getTriggerOptions } = await import('@/lib/logs/get-trigger-options')
    const valuesByLabel = new Map<string, string[]>()
    for (const option of getTriggerOptions()) {
      const values = valuesByLabel.get(option.label)
      if (values) values.push(option.value)
      else valuesByLabel.set(option.label, [option.value])
    }
    return {
      kind: 'list',
      items: Array.from(valuesByLabel, ([label, values]) => ({
        id: values.join(','),
        label,
      })),
    }
  },
} satisfies Record<LocalSelectorKey, LocalSelectorAttachment>
