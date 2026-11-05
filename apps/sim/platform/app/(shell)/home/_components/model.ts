import type { ComposerReferences } from '@/platform/app/(shell)/_components/composer/model'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

interface AttentionItem {
  id: string
  title: string
  detail: string
  occurredAt: number
  icon: IconName
}

export interface HomeData {
  asOf: number
  firstName: string
  address: string
  attention: AttentionItem[]
  /** Sorted UTC day buckets. Days omitted between the first and last bucket have zero activity. */
  activity: { date: string; tasks: number; searches: number }[]
  email: {
    id: string
    avatar?: string
    sender: string
    subject: string
    excerpt: string
    receivedAt: number
    count?: number
  }[]
  calendar: {
    date: string
    nowMinute: number
    meetings: {
      id: string
      title: string
      startMinute: number
      duration: number
      providerUrl?: string
      people: { name: string; src?: string }[]
    }[]
  }
  references?: ComposerReferences
  connected: boolean
}
