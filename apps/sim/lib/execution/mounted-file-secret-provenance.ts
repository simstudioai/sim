import type { WorkspaceFileSecretProvenanceEntry } from '@sim/db/schema'
import { decryptSecret } from '@/lib/core/security/encryption'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  createResolvedSecretMatcher,
  scanResolvedSecretString,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'

const MAX_MOUNTED_FILE_SECRET_MATCH_EVENTS = 1_000_000
const ANONYMOUS_MOUNTED_FILE_SECRET_NAME = 'MOUNTED_FILE_SECRET'

export interface MountedFileSecretProvenanceScanner {
  /**
   * True when the mount actually carried secret material. False means the mounted files were
   * classified and contributed nothing, so no mounted secret can reach an output file — which lets
   * callers classify content this scanner cannot soundly scan (binary bytes) instead of failing closed.
   */
  hasSecrets: boolean
  scan(buffer: Buffer): WorkspaceFileSecretProvenance
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Builds a bounded output-file classifier from encrypted provenance carried across the trusted
 * Function request boundary. Plaintext exists only in this route-local scanner and is never added
 * to sandbox environment variables or functional request/response payloads.
 */
export async function createMountedFileSecretProvenanceScanner(
  provenance: ResolvedSecretTraceProvenanceV1
): Promise<MountedFileSecretProvenanceScanner | undefined> {
  if (!provenance.complete || !provenance.scope?.userId) return undefined

  const entriesByScanLiteral = new Map<string, Map<string, WorkspaceFileSecretProvenanceEntry>>()
  try {
    for (const entry of provenance.entries) {
      const { decrypted: plaintext } = await decryptSecret(entry.encryptedValue)
      if (!plaintext) continue
      const fileEntry = {
        name: entry.name || ANONYMOUS_MOUNTED_FILE_SECRET_NAME,
        encryptedValue: entry.encryptedValue,
        sourceUserId: provenance.scope.userId,
        ...(provenance.scope?.workspaceId
          ? { sourceWorkspaceId: provenance.scope.workspaceId }
          : {}),
      }
      for (const scanLiteral of new Set([plaintext, JSON.stringify(plaintext).slice(1, -1)])) {
        const entries =
          entriesByScanLiteral.get(scanLiteral) ??
          new Map<string, WorkspaceFileSecretProvenanceEntry>()
        entries.set(
          `${fileEntry.sourceUserId}\u0000${fileEntry.sourceWorkspaceId ?? ''}\u0000${fileEntry.name}\u0000${fileEntry.encryptedValue}`,
          fileEntry
        )
        entriesByScanLiteral.set(scanLiteral, entries)
      }
    }
  } catch {
    return undefined
  }

  if (entriesByScanLiteral.size === 0) {
    return { hasSecrets: false, scan: () => ({ status: 'exact', entries: [] }) }
  }

  let matcher
  try {
    matcher = createResolvedSecretMatcher(
      [...entriesByScanLiteral.keys()].map((plaintext) => ({ plaintext, replacement: '' }))
    )
  } catch {
    return undefined
  }
  if (!matcher) {
    return { hasSecrets: false, scan: () => ({ status: 'exact', entries: [] }) }
  }

  return {
    hasSecrets: true,
    scan(buffer) {
      const matched = new Map<string, WorkspaceFileSecretProvenanceEntry>()
      try {
        scanResolvedSecretString(
          buffer.toString('utf8'),
          matcher,
          (scanLiteral) => {
            for (const entry of entriesByScanLiteral.get(scanLiteral)?.values() ?? []) {
              matched.set(
                `${entry.sourceUserId}\u0000${entry.sourceWorkspaceId ?? ''}\u0000${entry.name}\u0000${entry.encryptedValue}`,
                entry
              )
            }
          },
          MAX_MOUNTED_FILE_SECRET_MATCH_EVENTS
        )
      } catch {
        return { status: 'unknown' }
      }

      return {
        status: 'exact',
        entries: [...matched.values()].sort(
          (left, right) =>
            compareStrings(left.sourceUserId, right.sourceUserId) ||
            compareStrings(left.sourceWorkspaceId ?? '', right.sourceWorkspaceId ?? '') ||
            compareStrings(left.name, right.name) ||
            compareStrings(left.encryptedValue, right.encryptedValue)
        ),
      }
    },
  }
}
