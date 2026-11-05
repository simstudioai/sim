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
    thinking?: string
    progress?: string
    failure?: string
    paragraphs: { lead?: string; text: string }[]
    steps: {
      id: string
      name: string
      detail?: string
      time: string
      input: string
      output: string
    }[]
    time: string
  }
}

export type ComposerReferences = { group: string; items: { id: string; name: string }[] }[]
