'use client'

import { useEffect, useRef } from 'react'
import { type FitBoundsOptions, useNodesInitialized, useReactFlow, useStore } from '@xyflow/react'

interface FitViewAfterInitProps {
  options: FitBoundsOptions
}

/** Fits measured bounds once, preserving the reader's pan and zoom during inspection. */
export function FitViewAfterInit({ options }: FitViewAfterInitProps) {
  const fitted = useRef(false)
  const nodesInitialized = useNodesInitialized()
  const hasViewportSize = useStore((state) => state.width > 0 && state.height > 0)
  const { fitBounds, getNodes, getNodesBounds, viewportInitialized } = useReactFlow()

  useEffect(() => {
    if (fitted.current || !nodesInitialized || !viewportInitialized || !hasViewportSize) return
    fitted.current = true
    void fitBounds(getNodesBounds(getNodes()), options)
  }, [
    fitBounds,
    getNodes,
    getNodesBounds,
    hasViewportSize,
    nodesInitialized,
    options,
    viewportInitialized,
  ])

  return null
}
