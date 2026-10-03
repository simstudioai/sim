import { describe, expect, it } from 'vitest'
import { collectMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'

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
})
