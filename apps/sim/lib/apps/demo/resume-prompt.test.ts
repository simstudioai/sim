import { describe, expect, it } from 'vitest'
import {
  FULLSTACK_CREDENTIAL_RESUME_MESSAGE,
  findOriginalBuilderPrompt,
} from '@/lib/apps/demo/resume-prompt'

describe('findOriginalBuilderPrompt', () => {
  it('recovers the original user intent instead of the credential resume placeholder', () => {
    expect(
      findOriginalBuilderPrompt([
        { role: 'user', content: 'Build a TikTok profile app' },
        { role: 'assistant', content: 'Select an account' },
        { role: 'user', content: FULLSTACK_CREDENTIAL_RESUME_MESSAGE },
      ])
    ).toBe('Build a TikTok profile app')
  })
})
