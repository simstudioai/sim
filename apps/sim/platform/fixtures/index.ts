import 'server-only'

export type Scenario = 'empty' | 'full' | 'stress'

export interface PreviewData {
  dashboard: {
    destinations: string[]
    metrics: { label: string; value: string }[]
    rows: { id: string; values: Record<string, string | number> }[]
  }
  samples: {
    avatarSrc?: string
    media?: { src: string; label: string }
    recipients: { address: string; invalid?: boolean }[]
    ranges: string[]
    actions: string[]
    notes: string
  }
  charts: { trend: number[]; bars: [number, number][]; distribution: number[] }
  specimen: Readonly<Record<string, string>>
  organization: { name: string; members: string[]; workspaces: { name: string; chats: string[] }[] }
}

export async function loadPreviewData(scenario: Scenario): Promise<PreviewData | null> {
  if (process.env.SIM_PLATFORM_FIXTURES !== '1') return null
  const { scenarios } = await import('@/platform/fixtures/data')
  return scenarios[scenario]
}
