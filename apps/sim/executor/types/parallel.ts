import type { SerializedParallel } from '@/serializer/types'

export interface ParallelConfigWithNodes extends SerializedParallel {
  nodes: string[]
}

export function isParallelConfigWithNodes(
  config: SerializedParallel
): config is ParallelConfigWithNodes {
  return Array.isArray((config as any).nodes)
}
