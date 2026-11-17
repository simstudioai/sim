import { type Json, sha256Hex, stableStringify } from '@sim/workflow-code'
import type { ResourceFingerprint } from './base'

/** A resource's fingerprint: `rf1:` + SHA-256 of its canonical declaration's stable JSON. */
export function fingerprintOf(canonical: Json): ResourceFingerprint {
  return `rf1:${sha256Hex(stableStringify(canonical))}`
}
