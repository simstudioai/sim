import { type Json, sha256Hex, stableStringify } from '@sim/workflow-code'
import type { ResourceFingerprint } from './base'

/**
 * A resource's fingerprint: `rf1:` + SHA-256 of its canonical declaration's stable JSON.
 *
 * Every base in the field records these, so changing what a kind's `canonical` returns (or how it
 * is hashed) makes every outstanding checkout read as edited or stale. Such a change is a format
 * change: it bumps the prefix (`rf2:`) and accepts the old one for a release. `fingerprint.test.ts`
 * pins the output for fixed declarations so the change cannot happen unnoticed.
 */
export function fingerprintOf(canonical: Json): ResourceFingerprint {
  return `rf1:${sha256Hex(stableStringify(canonical))}`
}
