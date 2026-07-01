import { useEffect, useMemo, useRef } from 'react'
import { useUpdateNodeInternals } from 'reactflow'
import {
  collectDynamicHandleTopologySignatures,
  getChangedDynamicHandleBlockIds,
} from '@/lib/workflows/dynamic-handle-topology'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export function useDynamicHandleRefresh() {
  const updateNodeInternals = useUpdateNodeInternals()
  const blocks = useWorkflowStore((state) => state.blocks)
  const previousSignaturesRef = useRef<Map<string, string> | null>(null)
  if (previousSignaturesRef.current === null) {
    previousSignaturesRef.current = new Map()
  }

  const signatures = useMemo(() => collectDynamicHandleTopologySignatures(blocks), [blocks])

  useEffect(() => {
    const changedBlockIds = getChangedDynamicHandleBlockIds(
      previousSignaturesRef.current ?? new Map(),
      signatures
    )
    previousSignaturesRef.current = signatures

    if (changedBlockIds.length === 0) {
      return
    }

    const frameId = requestAnimationFrame(() => {
      changedBlockIds.forEach((blockId) => updateNodeInternals(blockId))
    })

    return () => cancelAnimationFrame(frameId)
  }, [signatures, updateNodeInternals])
}
