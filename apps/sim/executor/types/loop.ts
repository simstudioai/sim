import type { SerializedLoop } from '@/serializer/types'

export interface LoopConfigWithNodes extends SerializedLoop {
  nodes: string[]
}
