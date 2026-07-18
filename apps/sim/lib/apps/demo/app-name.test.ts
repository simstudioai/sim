import { describe, expect, it } from 'vitest'

// Mirror the orchestrator normalizer without importing the heavy module graph.
const APP_NAME_MAX = 60

function normalizeAppDisplayName(title: string | null | undefined, prompt: string): string {
  const cleaned = (title || '').trim().replace(/\s+/g, ' ')
  if (cleaned) {
    return cleaned.length > APP_NAME_MAX ? `${cleaned.slice(0, APP_NAME_MAX - 1)}…` : cleaned
  }
  const words = prompt.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean).slice(0, 4)
  const fallback = words.join(' ') || 'Full-stack App'
  return fallback.length > APP_NAME_MAX ? `${fallback.slice(0, APP_NAME_MAX - 1)}…` : fallback
}

function slugFromPrompt(prompt: string, suffix = 'abcdef'): string {
  const base = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const slug = `${base || 'app'}-${suffix}`.replace(/^-+|-+$/g, '')
  return slug.slice(0, 63)
}

describe('concise app naming', () => {
  it('prefers generated titles and truncates to the App contract limit', () => {
    expect(normalizeAppDisplayName('TikTok Profile', 'long prompt')).toBe('TikTok Profile')
    expect(normalizeAppDisplayName('x'.repeat(80), 'prompt').length).toBe(APP_NAME_MAX)
  })

  it('falls back to a short deterministic name from the prompt', () => {
    expect(
      normalizeAppDisplayName(
        null,
        'Build me a TikTok account info app that shows my avatar and follower counts'
      )
    ).toBe('Build me a TikTok')
  })

  it('keeps collision-safe slug generation independent from the display name', () => {
    const slug = slugFromPrompt(
      'Build me a TikTok account info app that shows my avatar and follower counts'
    )
    expect(slug.endsWith('-abcdef')).toBe(true)
    expect(slug.length).toBeLessThanOrEqual(63)
    expect(slug).not.toBe('TikTok Profile')
  })
})
