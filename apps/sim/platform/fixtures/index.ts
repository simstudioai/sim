import 'server-only'
import type { AttachmentItem } from '@/platform/design-system/components/attachment-grid'
import type { PropertyItem } from '@/platform/design-system/components/property-list'
import type { RecentItem } from '@/platform/design-system/components/recent-items'

export type Scenario = 'empty' | 'full' | 'stress'

export interface PreviewData {
  collections: {
    recent: RecentItem[]
    attachments: AttachmentItem[]
    steps: { id: string; description: string }[]
  }
  dashboard: {
    destinations: string[]
    metrics: { label: string; value: string }[]
    rows: { id: string; values: Partial<Record<string, string | number | null>> }[]
  }
  samples: {
    labels: string[]
    captions: string[]
    properties: PropertyItem[]
    avatarSrc?: string
    media?: { src: string; label: string }
    recipients: { address: string; invalid?: boolean }[]
    ranges: string[]
    actions: string[]
    notes: string
  }
  charts: {
    maximum?: number
    trend: { label: string; value: number }[]
    bars: { label: string; values: [number, number] }[]
    distribution: { label: string; value: number }[]
  }
  specimen: Readonly<Record<string, string>>
  organization: {
    name: string
    members: string[]
    permissionGroups: string[]
    workspaces: { id: string; name: string; chats: string[] }[]
  }
}

export async function loadPreviewData(scenario: Scenario): Promise<PreviewData | null> {
  if (process.env.SIM_PLATFORM_FIXTURES !== '1') return null
  const { scenarios } = await import('@/platform/fixtures/data')
  return scenarios[scenario]
}
