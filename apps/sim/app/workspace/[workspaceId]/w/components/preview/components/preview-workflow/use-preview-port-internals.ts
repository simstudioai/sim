'use client'

import { useLayoutEffect } from 'react'
import { useUpdateNodeInternals } from '@xyflow/react'
import type { CanvasPort } from '@/lib/workflows/blocks/canvas-ports'

/** Handle order can change without resizing the node, so refresh React Flow's bounds explicitly. */
export function usePreviewPortInternals(nodeId: string, ports: readonly CanvasPort[]) {
  const updateNodeInternals = useUpdateNodeInternals()
  const signature = JSON.stringify(ports.map(({ handleId, type }) => [type, handleId]))
  useLayoutEffect(() => {
    updateNodeInternals(nodeId)
  }, [nodeId, signature, updateNodeInternals])
}
