import { createHash } from 'node:crypto'

/** Opaque model-facing handle; object-store keys remain server-only. */
export function getMemoryArtifactHandle(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}
