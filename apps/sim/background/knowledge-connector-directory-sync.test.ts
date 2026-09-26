import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it, vi } from 'vitest'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('@/lib/knowledge/connectors/external-group-sync', () => ({
  refreshConnectorDirectory: refresh,
}))

import { executeDirectorySyncJob } from '@/background/knowledge-connector-directory-sync'
import { GoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'
import { ConnectorDirectoryError } from '@/connectors/source-error'

const PAYLOAD = { connectorId: 'connector-1', requestId: 'request-1' }

describe('directory sync worker diagnostics', () => {
  it('includes the Google operation and reason in the final task failure', async () => {
    refresh.mockRejectedValueOnce(
      new ConnectorDirectoryError('private group detail', {
        cause: new GoogleDriveApiError(403, ['forbidden'], 'directory.members.list'),
      })
    )
    const error = await executeDirectorySyncJob(PAYLOAD).catch((error: unknown) => error)
    expect(error).toMatchObject({
      message:
        'Directory permission sync failed (HTTP 403). Operation: directory.members.list. Google reason: forbidden. Group membership could not be fully verified.',
    })
    expect(error).not.toHaveProperty('cause')
    expect(String(error)).not.toContain('private')
  })

  it('preserves database codes without exposing the raw driver cause to Trigger', async () => {
    refresh.mockRejectedValueOnce(
      new DrizzleQueryError(
        'select private SQL',
        ['private value'],
        Object.assign(new Error('private driver detail'), { code: '57014' })
      )
    )
    const error = await executeDirectorySyncJob(PAYLOAD).catch((error: unknown) => error)
    expect(error).toMatchObject({ message: 'Database request failed (SQLSTATE 57014).' })
    expect(error).not.toHaveProperty('cause')
    expect(String(error)).not.toContain('private')
  })
})
