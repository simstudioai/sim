import type { CopilotToolCall, ToolState } from '@/stores/panel'

export type NotificationStatus =
  | 'pending'
  | 'success'
  | 'error'
  | 'accepted'
  | 'rejected'
  | 'background'
  | 'cancelled'

export type { CopilotToolCall, ToolState }

export interface AvailableModel {
  id: string
  friendlyName: string
  provider: string
}
