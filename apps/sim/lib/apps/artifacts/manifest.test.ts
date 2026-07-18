import { describe, expect, it } from 'vitest'
import { assertSafeArtifactPath, buildArtifactManifest } from '@/lib/apps/artifacts/manifest'

describe('buildArtifactManifest', () => {
  it('hashes deterministically regardless of input order', () => {
    const a = buildArtifactManifest([
      { path: 'assets/a.js', content: Buffer.from('aaa') },
      { path: 'index.html', content: Buffer.from('<html></html>') },
    ])
    const b = buildArtifactManifest([
      { path: 'index.html', content: Buffer.from('<html></html>') },
      { path: 'assets/a.js', content: Buffer.from('aaa') },
    ])
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.manifestHash).toBe(b.manifestHash)
      expect(a.manifestHash.startsWith('sha256:')).toBe(true)
    }
  })

  it('rejects path traversal and strips source maps', () => {
    expect(assertSafeArtifactPath('../x.js')).toBeTruthy()
    expect(assertSafeArtifactPath('assets/app.js.map')).toBeTruthy()
    const built = buildArtifactManifest([
      { path: 'index.html', content: Buffer.from('x') },
      { path: 'assets/app.js.map', content: Buffer.from('{}') },
    ])
    expect(built.ok).toBe(true)
    if (built.ok) {
      expect(built.manifest.files.map((f) => f.path)).toEqual(['index.html'])
    }
  })

  it('verifies canonical digest on parse', async () => {
    const { hashArtifactManifest, parseAndVerifyArtifactManifest, canonicalManifestBytes } =
      await import('@/lib/apps/artifacts/manifest')
    const built = buildArtifactManifest([{ path: 'index.html', content: Buffer.from('x') }])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const canonical = JSON.parse(canonicalManifestBytes(built.manifest))
    expect(parseAndVerifyArtifactManifest(canonical, built.manifestHash)).not.toBeNull()
    expect(hashArtifactManifest(built.manifest)).toBe(built.manifestHash)
    expect(parseAndVerifyArtifactManifest(canonical, `sha256:${'0'.repeat(64)}`)).toBeNull()
  })
})
