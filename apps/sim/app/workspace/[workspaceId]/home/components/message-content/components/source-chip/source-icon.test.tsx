/** @vitest-environment jsdom */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SourceIcon } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip/source-icon'

describe('source hostname branding', () => {
  it.each([
    'https://example.slack.com/archives/channel/message',
    'https://app.slack.com/client/team/channel',
    'https://SLACK.COM/help',
    'https://www.github.com/example/project',
    'https://www.gitlab.com/example/project',
    'https://www.notion.so/example',
  ])('renders a local brand instead of requesting a favicon for a recognized host: %s', (url) => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(<SourceIcon source={{ url }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it.each([
    'https://notslack.com/channel',
    'https://slack.com.example.org/channel',
    'https://slack.com@example.org/channel',
    'https://example.org/slack.com',
    'https://example.org/?url=https://example.slack.com',
  ])('retains the actual destination favicon for a lookalike URL: %s', (url) => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(<SourceIcon source={{ url }} />)
    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    expect(new URL(image!.src).searchParams.get('domain')).toBe(new URL(url).hostname)
  })
})
