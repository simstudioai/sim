import { describe, expect, it } from 'vitest'
import {
  computeRetainedArtifactHashes,
  resolveArtifactGcPath,
  selectArtifactGcCandidates,
} from '@/lib/apps/blob-gc'

describe('App blob GC planning', () => {
  it('retains manifest and file hashes referenced by live manifests', async () => {
    const manifestHash = `sha256:${'a'.repeat(64)}`
    const result = await computeRetainedArtifactHashes([manifestHash], async () => ({
      version: 1,
      entrypoint: 'index.html',
      files: [
        {
          path: 'index.html',
          hash: 'b'.repeat(64),
          byteSize: 10,
          contentType: 'text/html',
        },
      ],
    }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hashes).toEqual(new Set(['a'.repeat(64), 'b'.repeat(64)]))
    }
  })

  it('fails closed when a retained manifest cannot be loaded', async () => {
    const result = await computeRetainedArtifactHashes(
      [`sha256:${'a'.repeat(64)}`],
      async () => null
    )
    expect(result.ok).toBe(false)
  })

  it('selects only old unreferenced artifact rows', () => {
    const cutoff = new Date('2026-01-02T00:00:00.000Z')
    const rows = [
      {
        hash: 'a'.repeat(64),
        storageKey: `blobs/${'a'.repeat(64)}`,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        hash: 'b'.repeat(64),
        storageKey: `blobs/${'b'.repeat(64)}`,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        hash: 'c'.repeat(64),
        storageKey: `blobs/${'c'.repeat(64)}`,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ]
    const selected = selectArtifactGcCandidates(rows, new Set(['a'.repeat(64)]), cutoff)
    expect(selected.map((row) => row.hash)).toEqual(['b'.repeat(64)])
  })

  it('rejects unexpected storage keys and contains valid paths under the artifact root', () => {
    const hash = 'd'.repeat(64)
    expect(
      resolveArtifactGcPath('/tmp/apps-artifacts', {
        hash,
        storageKey: `blobs/${hash}`,
      })
    ).toBe(`/tmp/apps-artifacts/blobs/${hash}`)
    expect(
      resolveArtifactGcPath('/tmp/apps-artifacts', {
        hash,
        storageKey: '../../etc/passwd',
      })
    ).toBeNull()
  })
})
