import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import type { UserFile } from '@/executor/types'

export const SANDBOX_FILE_MOUNT_REF_MARKER = '__simSandboxFileMount'
export const SANDBOX_FILE_MOUNT_REF_VERSION = 1

/**
 * A request to place one file on the sandbox filesystem, standing in for the
 * path until the sandbox exists.
 *
 * Emitted when code references `<block.file.path>`. Reference resolution happens
 * long before a sandbox is created, and mount paths are only known once the whole
 * set is planned (they are sanitized and de-duplicated together), so the resolver
 * leaves this marker and the function runtime swaps in the real path.
 *
 * Same shape as {@link LargeValueRef}: a marker a later layer materializes. It
 * exists only where the caller wrote `.path`, which is what keeps a bare
 * `<block.file>` reference — the common case, and the one that runs fine in the
 * isolated VM — from being dragged into a remote sandbox it never needed.
 */
export interface SandboxFileMountRef {
  [SANDBOX_FILE_MOUNT_REF_MARKER]: true
  version: typeof SANDBOX_FILE_MOUNT_REF_VERSION
  file: UserFile
}

export function createSandboxFileMountRef(file: UserFile): SandboxFileMountRef {
  return {
    [SANDBOX_FILE_MOUNT_REF_MARKER]: true,
    version: SANDBOX_FILE_MOUNT_REF_VERSION,
    file,
  }
}

export function isSandboxFileMountRef(value: unknown): value is SandboxFileMountRef {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    candidate[SANDBOX_FILE_MOUNT_REF_MARKER] === true &&
    candidate.version === SANDBOX_FILE_MOUNT_REF_VERSION &&
    isUserFileWithMetadata(candidate.file)
  )
}

/**
 * Replaces every mount marker in a value with whatever `resolvePath` returns for
 * its file, leaving the rest of the structure untouched.
 *
 * Rebuilds containers rather than mutating them: the same resolved block output
 * can be shared with other consumers, and a marker can sit anywhere inside a
 * referenced object, not only at the top level.
 */
export function replaceSandboxFileMountRefs(
  value: unknown,
  resolvePath: (file: UserFile) => string,
  seen = new WeakMap<object, unknown>()
): unknown {
  if (!value || typeof value !== 'object') return value
  if (isSandboxFileMountRef(value)) return resolvePath(value.file)

  const existing = seen.get(value)
  if (existing !== undefined) return existing

  if (Array.isArray(value)) {
    const next: unknown[] = []
    seen.set(value, next)
    for (const item of value) next.push(replaceSandboxFileMountRefs(item, resolvePath, seen))
    return next
  }

  // Only plain containers are rebuilt. A Date, Buffer, Map, or class instance
  // has no own enumerable entries worth walking, and reconstructing one from
  // Object.entries would quietly replace it with a stripped plain object — a
  // Date becoming `{}` on its way to the sandbox. Such a value cannot hold a
  // mount marker anyway, so passing it through is both safer and complete.
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value

  const next: Record<string, unknown> = {}
  seen.set(value, next)
  for (const [key, item] of Object.entries(value)) {
    // defineProperty, not assignment: a own `__proto__` key would otherwise hit
    // Object.prototype's setter and vanish before the value reaches the sandbox.
    Object.defineProperty(next, key, {
      value: replaceSandboxFileMountRefs(item, resolvePath, seen),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return next
}

/** Every file a value asks to have mounted, in first-seen order. */
export function collectSandboxFileMountRefs(
  value: unknown,
  found: UserFile[] = [],
  seen = new WeakSet<object>()
): UserFile[] {
  if (!value || typeof value !== 'object') return found
  if (isSandboxFileMountRef(value)) {
    found.push(value.file)
    return found
  }
  if (seen.has(value)) return found
  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) collectSandboxFileMountRefs(item, found, seen)
    return found
  }

  // Same plain-container rule the replacement pass applies. The two walks have to
  // agree on the tree: a marker counted here but skipped there would mount a file
  // whose reference never became a path.
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return found

  for (const item of Object.values(value)) {
    collectSandboxFileMountRefs(item, found, seen)
  }
  return found
}
