'use client'

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSubBlockStore, useWorkflowRegistry } from '@/platform/lib/data/workflow-editor'
import { SLACK_CAPABILITIES } from '@/triggers/slack/capabilities'

/**
 * The enabled Slack capability ids for a block, read from each capability's own sub-block value
 * in one shallow-compared selector. An unset value falls back to the capability's
 * `defaultChecked`, so an untouched block still reflects the defaults.
 */
export function useSlackCapabilitySelection(blockId: string): ReadonlySet<string> {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const enabledFlags = useSubBlockStore(
    useShallow((state) => {
      const blockValues = activeWorkflowId
        ? state.workflowValues[activeWorkflowId]?.[blockId]
        : undefined
      return SLACK_CAPABILITIES.map((capability) => {
        const raw = blockValues?.[capability.id]
        return typeof raw === 'boolean' ? raw : capability.defaultChecked
      })
    })
  )
  return useMemo(
    () =>
      new Set(
        SLACK_CAPABILITIES.filter((_, index) => enabledFlags[index]).map(
          (capability) => capability.id
        )
      ),
    [enabledFlags]
  )
}
