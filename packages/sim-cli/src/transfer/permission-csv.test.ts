import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SimApiError } from '#sim-cli/http/client'
import { stagePermissionCsvs } from '#sim-cli/transfer/permission-csv'

describe('Permission CSV staging errors', () => {
  it.each(['input', 'temporary directory'])(
    'preserves the cause of a missing %s',
    async (missing) => {
      const directory = await mkdtemp(join(tmpdir(), 'sim-csv-error-'))
      try {
        if (missing === 'temporary directory') vi.stubEnv('TMPDIR', join(directory, 'missing'))
        const failure = await stagePermissionCsvs('gitlab', {
          userMapping: join(directory, 'users.csv'),
          projectPermissions: join(directory, 'projects.csv'),
        }).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(SimApiError)
        expect(failure).toMatchObject({
          cause: expect.objectContaining({
            code: 'ENOENT',
            path: expect.any(String),
            syscall: missing === 'input' ? 'open' : 'mkdtemp',
          }),
        })
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )
})
