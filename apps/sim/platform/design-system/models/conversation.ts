import type { IconName } from '@/platform/design-system/catalog/icon-geometry'

export interface HomeRow {
  id: string
  title: string
  detail: string
  meta: string
  indicator?: IconName
  icon: IconName
}

export type HomeWidget = 'Tasks run' | 'Email' | 'Calendar'

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
      people: { name: string }[]
    }[]
  }
  references?: ConversationData['references']
  connected: boolean
}

export interface ChatAttachment {
  id: string
  name: string
  metadata: string
  kind: 'image' | 'document' | 'text' | 'reference'
  content?: string
  file?: File
  source?: string
}

export interface ComposerDraft {
  text: string
  attachments: ChatAttachment[]
}

export interface ChatTurn {
  id: string
  prompt: ComposerDraft
  time: string
  response?: {
    state: 'complete' | 'running' | 'failed' | 'stopped'
    duration: string
    paragraphs: string[]
    steps: { id: string; name: string; time: string; input: string; output: string }[]
    time: string
  }
}

export interface ConversationData {
  threads: { id: string; title: string; turns: ChatTurn[] }[]
  references: { group: string; items: { id: string; name: string }[] }[]
  draftAttachments: ChatAttachment[]
}
