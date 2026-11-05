import type { ComposerReferences } from '@/platform/app/(shell)/_components/composer/model'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

export interface HomeRow {
  id: string
  title: string
  detail: string
  meta: string
  indicator?: IconName
  icon: IconName
}

export interface HomeData {
  firstName: string
  address: string
  attention: HomeRow[]
  workspaces: HomeRow[]
  ranges: { label: string; points: { label: string; value: number }[] }[]
  email: {
    id: string
    avatar?: string
    sender: string
    subject: string
    excerpt: string
    received: string
    count?: number
  }[]
  calendar: {
    date: string
    times: string[]
    now?: string
    nowMinute?: number
    meetings: {
      id: string
      title: string
      time: string
      startMinute: number
      duration: number
      people: { name: string; src?: string }[]
    }[]
  }
  references?: ComposerReferences
  connected: boolean
}
