/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { runIsolated } = vi.hoisted(() => ({ runIsolated: vi.fn() }))
vi.mock('@/lib/apps/demo/headless-mothership', () => ({
  runDemoIsolatedAskPass: runIsolated,
}))

import {
  classifyFullstackFollowUpIntent,
  decideFullstackFollowUpIntent,
} from '@/lib/apps/demo/follow-up-intent'

describe('classifyFullstackFollowUpIntent', () => {
  it('routes styling/copy requests to frontend', () => {
    expect(classifyFullstackFollowUpIntent('make the button blue')).toBe('frontend')
    expect(classifyFullstackFollowUpIntent('Increase the avatar size')).toBe('frontend')
    expect(classifyFullstackFollowUpIntent('Change the heading copy')).toBe('frontend')
    expect(classifyFullstackFollowUpIntent('build an interface for it')).toBe('frontend')
  })

  it('routes integration/workflow requests to backend', () => {
    expect(classifyFullstackFollowUpIntent('Add a second Slack workflow')).toBe('backend')
    expect(classifyFullstackFollowUpIntent('Expose a new API input field')).toBe('backend')
  })

  it('defaults to both when uncertain or mixed', () => {
    expect(classifyFullstackFollowUpIntent('improve it')).toBe('both')
    expect(classifyFullstackFollowUpIntent('Update the UI and add a TikTok workflow')).toBe('both')
  })
})

describe('decideFullstackFollowUpIntent', () => {
  it('uses the strict structured decision from the isolated classifier', async () => {
    runIsolated.mockResolvedValue({
      success: true,
      content: '{"intent":"frontend"}',
      contentBlocks: [],
      toolCalls: [],
    })

    await expect(
      decideFullstackFollowUpIntent({
        prompt: 'change the app',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).resolves.toBe('frontend')
  })

  it('falls back safely when the classifier returns invalid JSON', async () => {
    runIsolated.mockResolvedValue({
      success: true,
      content: 'not json',
      contentBlocks: [],
      toolCalls: [],
    })

    await expect(
      decideFullstackFollowUpIntent({
        prompt: 'add another workflow',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).resolves.toBe('backend')
  })
})
