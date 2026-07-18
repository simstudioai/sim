import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildArtifactManifest, hashArtifactManifest } from '@/lib/apps/artifacts/manifest'
import { stableStringify } from '@/lib/apps/manifest'

/**
 * Apps-host keeps a duplicated canonicalizeJson / stableStringify.
 * Keep this fixture digest locked so a one-sided "fix" cannot drift silently.
 * Mirror of apps-host/src/server.ts canonicalizeJson.
 */
function hostCanonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(hostCanonicalizeJson)
  const obj = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = hostCanonicalizeJson(obj[key])
  }
  return sorted
}

function hostStableStringify(value: unknown): string {
  return JSON.stringify(hostCanonicalizeJson(value))
}

describe('Sim ↔ apps-host manifest canonical contract', () => {
  it('produces identical digests for the same manifest fixture', () => {
    const built = buildArtifactManifest([
      { path: 'assets/app.js', content: Buffer.from('console.log(1)') },
      { path: 'index.html', content: Buffer.from('<!doctype html><html></html>') },
      { path: 'assets/app.css', content: Buffer.from('body{margin:0}') },
    ])
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const simDigest = hashArtifactManifest(built.manifest)
    const hostDigest = `sha256:${createHash('sha256')
      .update(hostStableStringify(built.manifest))
      .digest('hex')}`
    const viaShared = `sha256:${createHash('sha256')
      .update(stableStringify(built.manifest))
      .digest('hex')}`

    expect(hostDigest).toBe(simDigest)
    expect(viaShared).toBe(simDigest)
    expect(simDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})
