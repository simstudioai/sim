/**
 * @vitest-environment node
 */
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { readSlack } from '@/lib/sim-search/live/slack'

const FILE_URL = 'https://files.slack.com/files-pri/T1-F123/plan'

function fileClient(file: Record<string, unknown>, download?: () => Promise<string>) {
  return {
    json: vi.fn(async () => ({
      ok: true,
      file: {
        title: 'Rollout plan',
        permalink: 'https://sim.slack.com/files/U1/F123/plan',
        preview_plain_text: 'Short preview',
        url_private: FILE_URL,
        size: 2048,
        ...file,
      },
    })),
    text: vi.fn(download ?? (async () => 'Full text')),
    bytes: vi.fn(),
  }
}

describe('Slack file reads', () => {
  it('reads the full text of a canvas from the Slack file host', async () => {
    const api = fileClient(
      { filetype: 'quip', mimetype: 'application/vnd.slack-docs' },
      async () => '<h1>Rollout</h1><p>Phase two starts after the audit.</p>'
    )
    const read = await readSlack(api, 'F123', undefined, 'file')
    expect(read.content).toContain('Phase two starts after the audit.')
    expect(read.content).not.toContain('<p>')
    expect(read.content).not.toContain('Short preview')
    expect(api.text).toHaveBeenCalledWith(
      '/files-pri/T1-F123/plan',
      {},
      expect.objectContaining({ service: 'slackFiles' })
    )
  })
  it('reads the full text of a text snippet', async () => {
    const api = fileClient(
      { filetype: 'text', mimetype: 'text/plain' },
      async () => 'line one\nline two'
    )
    expect((await readSlack(api, 'F123', undefined, 'file')).content).toBe('line one\nline two')
  })
  it('extracts the full text of a PDF downloaded from the Slack file host', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage().drawText('Phase two starts after the audit.', { x: 50, y: 700, font, size: 12 })
    const api = fileClient({ mimetype: 'application/pdf', filetype: 'pdf' })
    api.bytes.mockResolvedValue(Buffer.from(await pdf.save()))
    const read = await readSlack(api, 'F123', undefined, 'file')
    expect(read.content).toContain('Phase two starts after the audit.')
    expect(api.bytes).toHaveBeenCalledWith(
      '/files-pri/T1-F123/plan',
      {},
      expect.objectContaining({ service: 'slackFiles' })
    )
  })
  it('never sends the token to a file host other than Slack', async () => {
    for (const file of [
      { mimetype: 'text/plain', url_private: 'https://files.example.com/plan.txt' },
      { mimetype: 'text/plain', url_private: 'http://files.slack.com/files-pri/T1-F123/plan' },
      { mimetype: 'text/plain', is_external: true },
    ]) {
      const api = fileClient(file)
      expect((await readSlack(api, 'F123', undefined, 'file')).content).toContain('Short preview')
      expect(api.text).not.toHaveBeenCalled()
    }
  })
  it('keeps the preview, with the reason Slack gave, when Slack will not serve the file', async () => {
    const denied = fileClient({ mimetype: 'text/plain' }, async () => {
      throw new NativeSearchError('reconnect', 'The provider denied access.', undefined, 403)
    })
    const read = await readSlack(denied, 'F123', undefined, 'file')
    expect(read.content).toContain('Full text unavailable: The provider denied access.')
    expect(read.content).toContain('Short preview')
    for (const failure of [
      new Error('Too many redirects (max: 0)'),
      new DOMException('The operation timed out.', 'TimeoutError'),
    ]) {
      const api = fileClient({ mimetype: 'text/plain' }, async () => {
        throw failure
      })
      const caller = new AbortController().signal
      const read = await readSlack(api, 'F123', undefined, 'file', undefined, caller)
      expect(read.content).toContain('Short preview')
    }
  })
  it('does not let an abandoned download pass as a preview', async () => {
    const controller = new AbortController()
    const aborted = new DOMException('aborted', 'AbortError')
    const api = fileClient({ mimetype: 'text/plain' }, async () => {
      controller.abort(aborted)
      throw aborted
    })
    await expect(
      readSlack(api, 'F123', undefined, 'file', undefined, controller.signal)
    ).rejects.toBe(aborted)
  })
  it('keeps the preview when the file holds more text than one read returns', async () => {
    const api = fileClient({ mimetype: 'text/plain', size: undefined }, async () =>
      'x'.repeat(1024 * 1024 + 1)
    )
    expect((await readSlack(api, 'F123', undefined, 'file')).content).toContain('Short preview')
  })
  it('reads markup declared with parameters as HTML', async () => {
    const api = fileClient(
      { mimetype: 'Text/HTML; charset=utf-8' },
      async () => '<p>Rendered text</p>'
    )
    expect((await readSlack(api, 'F123', undefined, 'file')).content).toBe('Rendered text')
  })
  it('skips the download for files it cannot read as text', async () => {
    for (const file of [
      { mimetype: 'image/png', filetype: 'png' },
      { mimetype: 'text/plain', size: 2 * 1024 * 1024 },
      { filetype: 'quip', mimetype: 'application/vnd.slack-docs', size: 3 * 1024 * 1024 },
    ]) {
      const api = fileClient(file)
      expect((await readSlack(api, 'F123', undefined, 'file')).content).toContain('Short preview')
      expect(api.text).not.toHaveBeenCalled()
      expect(api.bytes).not.toHaveBeenCalled()
    }
  })
})
