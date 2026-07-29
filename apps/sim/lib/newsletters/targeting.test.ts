import { describe, expect, it } from 'vitest'
import { classifyNewsletterPrompt } from '@/lib/newsletters/targeting'

describe('classifyNewsletterPrompt', () => {
  it('maps everyone prompts to the everyone template', () => {
    expect(classifyNewsletterPrompt('newsletter to everyone')).toEqual({ type: 'everyone' })
  })

  it('maps Instagram integration prompts to the integration template', () => {
    expect(classifyNewsletterPrompt('Users who use the Instagram integration')).toEqual({
      type: 'integration_users',
      integration: 'instagram',
      timeWindowDays: null,
    })
  })

  it('keeps recent activity windows scoped to an Instagram target', () => {
    expect(classifyNewsletterPrompt('Instagram users active in the last 30 days')).toEqual({
      type: 'integration_users',
      integration: 'instagram',
      timeWindowDays: 30,
    })
  })

  it('maps Instagram chat context prompts to the chat mention template', () => {
    expect(classifyNewsletterPrompt('Instagram chat context in the last 90 days')).toEqual({
      type: 'chat_mentions',
      term: 'instagram',
      timeWindowDays: 90,
    })
  })

  it('defaults Instagram chat context to a bounded window', () => {
    expect(classifyNewsletterPrompt('Users whose chat context mentions Instagram')).toEqual({
      type: 'chat_mentions',
      term: 'instagram',
      timeWindowDays: 90,
    })
  })

  it('maps recent activity prompts to a bounded recent activity template', () => {
    expect(classifyNewsletterPrompt('recently active users in the last 30 days')).toEqual({
      type: 'recently_active',
      timeWindowDays: 30,
    })
  })

  it('rejects ambiguous prompts instead of falling back to everyone', () => {
    expect(() => classifyNewsletterPrompt('Users interested in productivity')).toThrow(
      'Targeting prompt is ambiguous'
    )
  })

  it('rejects negated prompts that would otherwise broaden to everyone', () => {
    expect(() => classifyNewsletterPrompt('Do not email everyone')).toThrow(
      'Targeting prompt is ambiguous'
    )
  })

  it('rejects broadening avoidance language', () => {
    expect(() => classifyNewsletterPrompt('Avoid everyone')).toThrow(
      'Targeting prompt is ambiguous'
    )
    expect(() => classifyNewsletterPrompt('Anyone but everyone')).toThrow(
      'Targeting prompt is ambiguous'
    )
    expect(() => classifyNewsletterPrompt('Skip everyone')).toThrow('Targeting prompt is ambiguous')
    expect(() => classifyNewsletterPrompt('Omit everyone')).toThrow('Targeting prompt is ambiguous')
    expect(() => classifyNewsletterPrompt('Everyone aside from recently active users')).toThrow(
      'Targeting prompt is ambiguous'
    )
  })

  it('rejects mixed targeting templates', () => {
    expect(() =>
      classifyNewsletterPrompt('Everyone plus users who use the Instagram integration')
    ).toThrow('Targeting prompt is ambiguous')
    expect(() =>
      classifyNewsletterPrompt('Instagram integration users and recently active users')
    ).toThrow('Targeting prompt is ambiguous')
  })

  it('bounds scoped Instagram activity when no window is supplied', () => {
    expect(classifyNewsletterPrompt('Instagram integration users recently active')).toEqual({
      type: 'integration_users',
      integration: 'instagram',
      timeWindowDays: 30,
    })
  })
})
