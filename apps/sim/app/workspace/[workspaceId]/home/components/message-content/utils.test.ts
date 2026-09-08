/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { collectMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'
import { deriveMessagePhase, resolveToolDisplayState } from './utils'

describe('deriveMessagePhase', () => {
  it('is streaming whenever the transport is live', () => {
    expect(deriveMessagePhase({ isStreaming: true, isRevealing: false })).toBe('streaming')
    expect(deriveMessagePhase({ isStreaming: true, isRevealing: true })).toBe('streaming')
  })

  it('is revealing when the transport stopped but text is still draining', () => {
    expect(deriveMessagePhase({ isStreaming: false, isRevealing: true })).toBe('revealing')
  })

  it('is settled once neither the transport nor the reveal is active', () => {
    expect(deriveMessagePhase({ isStreaming: false, isRevealing: false })).toBe('settled')
  })
})

describe('resolveToolDisplayState', () => {
  it('spins iff the tool is executing — a pure projection of its own status', () => {
    expect(resolveToolDisplayState('executing')).toBe('spinner')
  })

  it('maps cancelled and interrupted to their own glyphs', () => {
    expect(resolveToolDisplayState('cancelled')).toBe('cancelled')
    expect(resolveToolDisplayState('interrupted')).toBe('interrupted')
  })

  it('renders terminal successes and errors as the tool icon', () => {
    expect(resolveToolDisplayState('success')).toBe('icon')
    expect(resolveToolDisplayState('error')).toBe('icon')
    expect(resolveToolDisplayState('skipped')).toBe('icon')
    expect(resolveToolDisplayState('rejected')).toBe('icon')
  })
})

describe('collectMessageSources', () => {
  const source = (url: string, extra = '') => `<source>{"url":"${url}"${extra}}</source>`

  it('collects every distinct source across the given text, in first-cited order', () => {
    const texts = [
      `First point. ${source('https://a.example/1', ',"siteName":"A"')} Second. ${source('https://b.example/2')}`,
      `Again. ${source('https://a.example/1')} New. ${source('https://c.example/3')}`,
    ]

    expect(collectMessageSources(texts).map((entry) => entry.url)).toEqual([
      'https://a.example/1',
      'https://b.example/2',
      'https://c.example/3',
    ])
    expect(collectMessageSources(texts)[0].siteName).toBe('A')
  })

  it('returns nothing for prose without sources', () => {
    expect(collectMessageSources(['Plain prose.', ''])).toEqual([])
  })
})
