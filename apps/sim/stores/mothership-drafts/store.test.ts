import { describe, expect, it } from 'vitest'
import { dropLegacyWorkflowCopilotDrafts } from '@/stores/mothership-drafts/store'

const payload = { text: 'unsent' }

describe('dropLegacyWorkflowCopilotDrafts', () => {
  it('drops workflow-only copilot keys that no surface reads anymore', () => {
    const { drafts } = dropLegacyWorkflowCopilotDrafts({
      drafts: { 'ws-1:workflow-copilot:wf-1': payload },
    })

    expect(drafts).toEqual({})
  })

  it('keeps per-chat copilot keys, including the unselected-chat slot', () => {
    const drafts = {
      'ws-1:workflow-copilot:wf-1:chat-1': payload,
      'ws-1:workflow-copilot:wf-1:new': payload,
    }

    expect(dropLegacyWorkflowCopilotDrafts({ drafts }).drafts).toEqual(drafts)
  })
})
