'use client'

import { useEffect } from 'react'
import { type FitViewOptions, useNodesInitialized, useReactFlow } from '@xyflow/react'

interface FitViewAfterInitProps {
  options: FitViewOptions
}

/** Fits a v12 canvas only after every node has real measured dimensions. */
export function FitViewAfterInit({ options }: FitViewAfterInitProps) {
  const nodesInitialized = useNodesInitialized()
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (nodesInitialized) void fitView(options)
  }, [fitView, nodesInitialized, options])

  return null
}
