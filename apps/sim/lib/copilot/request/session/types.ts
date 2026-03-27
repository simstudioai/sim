import type {
  MothershipStreamV1EventType,
  MothershipStreamV1StreamScope,
} from '@/lib/copilot/generated/mothership-stream-v1'

export interface StreamEvent {
  type: MothershipStreamV1EventType
  payload: Record<string, unknown>
  scope?: MothershipStreamV1StreamScope
}
