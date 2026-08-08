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
   * True when the envelope attested to any secret material, whether or not it could be turned into
   * a scannable literal. False therefore means the mount carried nothing to leak — which lets
   * callers classify content this scanner cannot soundly scan (binary bytes) instead of failing
   * closed. Entries that fail to yield plaintext keep this true: losing the ability to scan them
   * makes the mount less classifiable, not more.
   */
  hasSecrets: boolean
  scan(buffer: Buffer): WorkspaceFileSecretProvenance
}

const UNKNOWN_MOUNTED_FILE_SECRET_PROVENANCE_SCANNER: MountedFileSecretProvenanceScanner = {
  hasSecrets: true,
  scan: () => ({ status: 'unknown' }),
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
  if (!provenance.complete) return UNKNOWN_MOUNTED_FILE_SECRET_PROVENANCE_SCANNER
  if (!provenance.scope?.userId) return undefined

  const hasSecrets = provenance.entries.length > 0
  const entriesByScanLiteral = new Map<string, Map<string, WorkspaceFileSecretProvenanceEntry>>()
  try {
    for (const entry of provenance.entries) {
      const { decrypted: plaintext } = await decryptSecret(entry.encryptedValue)
      if (!plaintext) continue
      const fileEntry: WorkspaceFileSecretProvenanceEntry = {
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
          `${fileEntry.sourceUserId}\u0000${fileEntry.sourceWorkspaceId ?? ''}\u0000${fileEntry.name ?? ''}\u0000${fileEntry.encryptedValue}`,
          fileEntry
        )
        entriesByScanLiteral.set(scanLiteral, entries)
      }
    }
  } catch {
    return UNKNOWN_MOUNTED_FILE_SECRET_PROVENANCE_SCANNER
  }

  if (entriesByScanLiteral.size === 0) {
    return { hasSecrets, scan: () => ({ status: 'exact', entries: [] }) }
  }

  let matcher
  try {
    matcher = createResolvedSecretMatcher(
      [...entriesByScanLiteral.keys()].map((plaintext) => ({ plaintext, replacement: '' }))
    )
  } catch {
    return UNKNOWN_MOUNTED_FILE_SECRET_PROVENANCE_SCANNER
  }
  if (!matcher) {
    return { hasSecrets, scan: () => ({ status: 'exact', entries: [] }) }
  }

  return {
    hasSecrets,
    scan(buffer) {
      const matched = new Map<string, WorkspaceFileSecretProvenanceEntry>()
      try {
        scanResolvedSecretString(
          buffer.toString('utf8'),
          matcher,
          (scanLiteral) => {
            for (const entry of entriesByScanLiteral.get(scanLiteral)?.values() ?? []) {
              matched.set(
                `${entry.sourceUserId}\u0000${entry.sourceWorkspaceId ?? ''}\u0000${entry.name ?? ''}\u0000${entry.encryptedValue}`,
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
            compareStrings(left.name ?? '', right.name ?? '') ||
            compareStrings(left.encryptedValue, right.encryptedValue)
        ),
      }
    },
  }
}
