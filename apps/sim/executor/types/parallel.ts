import type { SerializedParallel } from '@/serializer/types'

export interface ParallelConfigWithNodes extends SerializedParallel {
  nodes: string[]
}
