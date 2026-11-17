/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { assertSlackFileHost, slackFileDownloadUrl } from '@/lib/internal/slack/file-download'

const PRIVATE = 'https://files.slack.com/files-pri/T1-F1/report.pdf'
const DOWNLOAD = 'https://files.slack.com/files-pri/T1-F1/download/report.pdf'

describe('Slack file download URL', () => {
  it('prefers the download URL, which serves bytes where the private URL may redirect', () => {
    expect(
      slackFileDownloadUrl({ url_private: PRIVATE, url_private_download: DOWNLOAD })?.href
    ).toBe(DOWNLOAD)
    expect(slackFileDownloadUrl({ url_private: PRIVATE })?.href).toBe(PRIVATE)
  })
  it('never returns a URL for a file hosted outside Slack', () => {
    for (const file of [
      { is_external: true, url_private: PRIVATE },
      { mode: 'external', url_private: PRIVATE },
      { filetype: 'remote', url_private: PRIVATE },
      { url_private: 'https://files.example.com/report.pdf' },
      { url_private: 'https://files.slack.com.example.com/report.pdf' },
      { url_private: 'http://files.slack.com/files-pri/T1-F1/report.pdf' },
      { url_private_download: 'https://files.example.com/report.pdf', url_private: PRIVATE },
      { url_private: 'not a url' },
      {},
    ])
      expect(slackFileDownloadUrl(file)).toBeUndefined()
  })
  it('keeps a redirect on the Slack file host', () => {
    expect(() => assertSlackFileHost(DOWNLOAD)).not.toThrow()
    for (const target of [
      'https://slack-files.com/files-pri-safe/T1-F1/report.pdf',
      'https://team.slack.com/?redir=%2Ffiles-pri%2FT1-F1',
      'http://files.slack.com/files-pri/T1-F1/report.pdf',
    ])
      expect(() => assertSlackFileHost(target)).toThrow()
  })
})
