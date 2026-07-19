import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({ db: {} }))

import {
  buildFullstackDemoLifecycleSummary,
  validateFullstackCredentialResume,
} from '@/lib/apps/demo/lifecycle-state'

const selection = {
  bindingKey: 'wf:block:credential',
  workflowId: 'wf',
  blockId: 'block',
  subBlockId: 'credential',
  serviceId: 'tiktok',
  providerId: 'tiktok',
  choices: [
    { id: 'credential-1', displayName: 'Primary', providerId: 'tiktok' },
    { id: 'credential-2', displayName: 'Secondary', providerId: 'tiktok' },
  ],
}

describe('Full-stack demo lifecycle state', () => {
  it('captures a structured credential pause and validates an exact resume', () => {
    const summary = buildFullstackDemoLifecycleSummary({
      chatId: 'chat-1',
      originalPrompt: 'Build a TikTok app',
      event: {
        phase: 'credential_selection_required',
        projectId: 'project-1',
        workflowIds: ['wf'],
        resumeMode: 'backend_only',
        credentialSelections: [selection],
      },
    })

    expect(summary.status).toBe('credential_selection_required')
    expect(
      validateFullstackCredentialResume({
        summary,
        projectId: 'project-1',
        selections: { 'wf:block:credential': 'credential-2' },
      })
    ).toEqual({
      ok: true,
      projectId: 'project-1',
      workflowIds: ['wf'],
      originalPrompt: 'Build a TikTok app',
      resumeMode: 'backend_only',
    })
  })

  it('rejects missing, extra, and inaccessible selections', () => {
    const summary = buildFullstackDemoLifecycleSummary({
      chatId: 'chat-1',
      originalPrompt: 'Build an app',
      event: {
        phase: 'credential_selection_required',
        projectId: 'project-1',
        workflowIds: ['wf'],
        credentialSelections: [selection],
      },
    })

    expect(
      validateFullstackCredentialResume({
        summary,
        projectId: 'project-1',
        selections: {},
      }).ok
    ).toBe(false)
    expect(
      validateFullstackCredentialResume({
        summary,
        projectId: 'project-1',
        selections: {
          'wf:block:credential': 'credential-1',
          extra: 'credential-1',
        },
      }).ok
    ).toBe(false)
    expect(
      validateFullstackCredentialResume({
        summary,
        projectId: 'project-1',
        selections: { 'wf:block:credential': 'credential-not-allowed' },
      }).ok
    ).toBe(false)
  })
})
