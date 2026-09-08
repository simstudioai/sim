/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireSourceMirrored } = vi.hoisted(() => ({
  mockRequireSourceMirrored: vi.fn(async () => undefined),
}))

vi.mock('@/lib/knowledge/access/availability', () => ({
  requireSourceMirroredAccessAvailable: mockRequireSourceMirrored,
}))

import { assertConnectorMirrorsSourceAcls } from '@/lib/knowledge/connectors/mirrored-access'
import type { ConnectorMeta } from '@/connectors/types'

const impersonating: ConnectorMeta = {
  id: 'google_drive',
  name: 'Google Drive',
  description: '',
  version: '1',
  icon: () => null,
  auth: { mode: 'oauth', provider: 'google-drive', serviceAccountSubjectFieldId: 'adminEmail' },
  configFields: [],
  mirrorsSourceAcls: true,
}

const tokenBacked: ConnectorMeta = {
  ...impersonating,
  id: 'confluence',
  name: 'Confluence',
  auth: { mode: 'oauth', provider: 'confluence' },
}

describe('assertConnectorMirrorsSourceAcls', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refuses a connector that cannot mirror permissions at all', async () => {
    await expect(
      assertConnectorMirrorsSourceAcls({ ...tokenBacked, mirrorsSourceAcls: undefined }, {}, 'ws-1')
    ).rejects.toThrow('has no administrator mode')
  })

  it('refuses an impersonating connector with nobody to crawl as', async () => {
    await expect(assertConnectorMirrorsSourceAcls(impersonating, {}, 'ws-1')).rejects.toThrow(
      'needs the administrator to crawl as'
    )
  })

  it('accepts an impersonating connector once an administrator is named', async () => {
    await expect(
      assertConnectorMirrorsSourceAcls(impersonating, { adminEmail: 'admin@corp.com' }, 'ws-1')
    ).resolves.toBeUndefined()
  })

  /**
   * The bug this pins: a connector whose service account holds an API token
   * impersonates nobody and has no subject to require. Demanding one made
   * administrator mode unreachable for every such source.
   */
  it('accepts a token-backed connector that names no subject field', async () => {
    await expect(assertConnectorMirrorsSourceAcls(tokenBacked, {}, 'ws-1')).resolves.toBeUndefined()
  })

  it('refuses when the workspace is not entitled, before anything else', async () => {
    mockRequireSourceMirrored.mockRejectedValueOnce(new Error('not available'))

    await expect(
      assertConnectorMirrorsSourceAcls(impersonating, { adminEmail: 'admin@corp.com' }, 'ws-1')
    ).rejects.toThrow('not available')
  })
})
