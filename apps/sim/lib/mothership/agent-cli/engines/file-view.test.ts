/** @vitest-environment node */
import type { Principal } from '@sim/auth/principal'
import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/workspace-files/application/read-workspace-file-artifact', () => ({
  readWorkspaceFileArtifact: { execute: read },
}))

import { runEngine } from '@/lib/mothership/agent-cli/engines'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'
import { ArtifactObservations } from '@/lib/mothership/generated/observations'

const principal: Principal = { kind: 'session', userId: 'reader', sessionId: 'session' }
const runtime: AgentCliRuntime = {
  principal,
  workspaceId: 'trusted-workspace',
  userId: 'reader',
  client: {
    async request() {
      throw new Error('Unexpected v2 request')
    },
  },
}

describe('registered files view boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it.each(['image/png', 'application/pdf'])(
    'returns %s bytes through the shared observation contract',
    async (contentType) => {
      const pdf = await PDFDocument.create()
      pdf.addPage()
      const bytes =
        contentType === 'application/pdf'
          ? Buffer.from(await pdf.save())
          : Buffer.from([137, 80, 78, 71, 0, 255])
      read.mockResolvedValue({
        file: { id: 'canonical', name: 'report' },
        buffer: bytes,
        contentType,
      })
      const output = await runEngine('files view', ['requested'], runtime, {})
      ArtifactObservations.parse(output.observations)
      expect(output.exitCode).toBe(0)
      expect(output.observations?.[0]).toEqual({
        name: 'report',
        resourceId: 'canonical',
        mediaType: contentType,
        data: bytes.toString('base64'),
        ...(contentType === 'application/pdf' ? { pageCount: 1 } : {}),
      })
      expect(read).toHaveBeenCalledWith({
        principal,
        input: {
          workspaceId: 'trusted-workspace',
          reference: 'requested',
          maxBytes: 8 * 1024 * 1024,
        },
      })
    }
  )
  it('bounds PDF observations by pages and returns only the requested pages', async () => {
    const pdf = await PDFDocument.create()
    for (let i = 0; i < 25; i++) pdf.addPage([100 + i, 200])
    read.mockResolvedValue({
      file: { id: 'canonical', name: 'report.pdf' },
      contentType: 'application/pdf',
      buffer: Buffer.from(await pdf.save()),
    })
    expect((await runEngine('files view', ['requested'], runtime, {})).stderr).toContain('25 pages')
    for (const pages of ['0', '5-2', '1-21', '26', '1,4', '1-2junk']) {
      expect((await runEngine('files view', ['requested'], runtime, { pages })).exitCode).toBe(1)
    }
    const result = await runEngine('files view', ['requested'], runtime, { pages: '21-25' })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ pages: { first: 21, last: 25, total: 25 } })
    const bytes = result.observations?.[0]?.data
    expect(bytes).toBeDefined()
    const selected = await PDFDocument.load(Buffer.from(bytes ?? '', 'base64'))
    expect(selected.getPageCount()).toBe(5)
    expect(selected.getPage(0).getWidth()).toBe(120)
    expect(result.observations?.[0]?.pageCount).toBe(5)
  })
  it('requires the authenticated principal and hides internal storage errors', async () => {
    const { principal: _principal, ...anonymous } = runtime
    expect((await runEngine('files view', ['requested'], anonymous, {})).exitCode).toBe(1)
    expect(read).not.toHaveBeenCalled()
    read.mockRejectedValue(new Error('private database host and query'))
    const result = await runEngine('files view', ['requested'], runtime, {})
    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toContain('database host')
    expect(result.observations).toBeUndefined()
  })
})
