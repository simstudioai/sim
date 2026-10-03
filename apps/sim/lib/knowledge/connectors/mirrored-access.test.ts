import {
  knowledgeAvailabilityMock,
  knowledgeAvailabilityMockFns,
} from '@sim/testing/mocks/knowledge-availability.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/access/availability', () => knowledgeAvailabilityMock)

import { assertConnectorMirrorsSourceAcls } from '@/lib/knowledge/connectors/mirrored-access'
import type { ConnectorMeta } from '@/connectors/types'

const mockRequireSourceMirrored =
  knowledgeAvailabilityMockFns.mockRequireSourceMirroredAccessAvailable

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

  it('refuses when the workspace is not entitled, before anything else', async () => {
    mockRequireSourceMirrored.mockRejectedValueOnce(new Error('not available'))

    await expect(
      assertConnectorMirrorsSourceAcls(impersonating, { adminEmail: 'admin@corp.com' }, 'ws-1')
    ).rejects.toThrow('not available')
  })
})
