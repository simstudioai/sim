import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildArtifactManifest } from '@/lib/apps/artifacts/manifest'
import {
  assertArtifactBundleInputs,
  loadArtifactManifest,
  writeContentAddressedFile,
} from '@/lib/apps/artifacts/store'

vi.mock('@sim/db', () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  },
  runOutsideTransactionContext: <T>(fn: () => T): T => fn(),
}))

vi.mock('@sim/db/schema', () => ({
  appArtifactBlob: { hash: 'hash', byteSize: 'byteSize' },
}))

describe('assertArtifactBundleInputs', () => {
  it('rejects mismatched manifest hash and extra files', () => {
    const built = buildArtifactManifest([{ path: 'index.html', content: Buffer.from('<html/>') }])
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(
      assertArtifactBundleInputs({
        manifest: built.manifest,
        manifestHash: `sha256:${'0'.repeat(64)}`,
        files: [
          {
            path: 'index.html',
            content: Buffer.from('<html/>'),
            hash: built.manifest.files[0].hash,
            contentType: built.manifest.files[0].contentType,
            byteSize: built.manifest.files[0].byteSize,
          },
        ],
      }).ok
    ).toBe(false)

    expect(
      assertArtifactBundleInputs({
        manifest: built.manifest,
        manifestHash: built.manifestHash,
        files: [
          {
            path: 'index.html',
            content: Buffer.from('<html/>'),
            hash: built.manifest.files[0].hash,
            contentType: built.manifest.files[0].contentType,
            byteSize: built.manifest.files[0].byteSize,
          },
          {
            path: 'extra.js',
            content: Buffer.from('x'),
            hash: 'a'.repeat(64),
            contentType: 'text/javascript',
            byteSize: 1,
          },
        ],
      }).ok
    ).toBe(false)
  })

  it('accepts a consistent bundle', () => {
    const content = Buffer.from('<html>ok</html>')
    const built = buildArtifactManifest([{ path: 'index.html', content }])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const entry = built.manifest.files[0]
    const ok = assertArtifactBundleInputs({
      manifest: built.manifest,
      manifestHash: built.manifestHash,
      files: [
        {
          path: entry.path,
          content,
          hash: entry.hash,
          contentType: entry.contentType,
          byteSize: entry.byteSize,
        },
      ],
    })
    expect(ok.ok).toBe(true)
  })
})

describe('content-addressed filesystem', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sim-artifacts-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined)
  })

  it('persists once and rejects corrupt overwrite', async () => {
    const path = join(root, 'blobs', 'abc')
    const first = await writeContentAddressedFile(path, Buffer.from('hello'))
    expect(first.ok).toBe(true)
    const again = await writeContentAddressedFile(path, Buffer.from('hello'))
    expect(again.ok).toBe(true)
    const corrupt = await writeContentAddressedFile(path, Buffer.from('other'))
    expect(corrupt.ok).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('hello')
  })

  it('loadArtifactManifest verifies digest and rejects tampering', async () => {
    const { persistArtifactBundle } = await import('@/lib/apps/artifacts/store')
    const content = Buffer.from('<html>app</html>')
    const built = buildArtifactManifest([{ path: 'index.html', content }])
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const entry = built.manifest.files[0]
    const persisted = await persistArtifactBundle({
      root,
      manifest: built.manifest,
      manifestHash: built.manifestHash,
      files: [
        {
          path: entry.path,
          content,
          hash: entry.hash,
          contentType: entry.contentType,
          byteSize: entry.byteSize,
        },
      ],
    })
    expect(persisted.ok).toBe(true)

    const loaded = await loadArtifactManifest(built.manifestHash, root)
    expect(loaded).not.toBeNull()
    expect(loaded?.files[0].path).toBe('index.html')

    const digest = built.manifestHash.slice('sha256:'.length)
    const manifestFile = join(root, 'manifests', `${digest}.json`)
    await writeFile(manifestFile, '{"version":1,"entrypoint":"index.html","files":[]}\n')
    const tampered = await loadArtifactManifest(built.manifestHash, root)
    expect(tampered).toBeNull()
  })

  it('accepts an existing semantically identical manifest with different whitespace', async () => {
    const { persistArtifactBundle } = await import('@/lib/apps/artifacts/store')
    const content = Buffer.from('<html>app</html>')
    const built = buildArtifactManifest([{ path: 'index.html', content }])
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const entry = built.manifest.files[0]
    const digest = built.manifestHash.slice('sha256:'.length)
    const manifestFile = join(root, 'manifests', `${digest}.json`)
    await mkdir(join(root, 'manifests'), { recursive: true })
    await writeFile(manifestFile, JSON.stringify(built.manifest, null, 2))

    const persisted = await persistArtifactBundle({
      root,
      manifest: built.manifest,
      manifestHash: built.manifestHash,
      files: [
        {
          path: entry.path,
          content,
          hash: entry.hash,
          contentType: entry.contentType,
          byteSize: entry.byteSize,
        },
      ],
    })
    expect(persisted.ok).toBe(true)
  })
})
