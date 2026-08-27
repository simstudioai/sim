/**
 * @vitest-environment node
 */
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

  it('keeps home drafts, whose key shape did not change', () => {
    const { drafts } = dropLegacyWorkflowCopilotDrafts({
      drafts: { 'ws-1:chat-1': payload, 'ws-1:new': payload },
    })

    expect(drafts).toEqual({ 'ws-1:chat-1': payload, 'ws-1:new': payload })
  })

  it('keeps per-chat copilot keys, including the unselected-chat slot', () => {
    const drafts = {
      'ws-1:workflow-copilot:wf-1:chat-1': payload,
      'ws-1:workflow-copilot:wf-1:new': payload,
    }

    expect(dropLegacyWorkflowCopilotDrafts({ drafts }).drafts).toEqual(drafts)
  })

  it('returns an empty map when nothing was persisted', () => {
    expect(dropLegacyWorkflowCopilotDrafts(null).drafts).toEqual({})
    expect(dropLegacyWorkflowCopilotDrafts({}).drafts).toEqual({})
  })
})
