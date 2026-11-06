import type { Principal } from '@sim/auth/principal'
import {
  admitContent,
  admitEach,
  ContentRefusedError,
  type ContentView,
  isCopilotPrincipal,
} from '@/lib/core/application'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import { getStoredFileSecretProvenanceByKey } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import type { UserFile } from '@/executor/types'

/** Admits each run file on its own; see {@link admitRunFiles}. Returns the admitted files. */
async function admitRunFileItems(
  principal: Principal,
  workspaceId: string,
  files: readonly UserFile[],
  view: ContentView
): Promise<UserFile[]> {
  return admitEach(principal, files, async (items) => {
    const provenance = await getStoredFileSecretProvenanceByKey(
      workspaceId,
      items.map((file) => file.key)
    )
    return items.map((file) => ({
      kind: 'execution-file' as const,
      id: file.id,
      /** A run file no metadata row names predates them: an absence, audited, not taint. */
      provenance: provenance.has(file.key)
        ? (provenance.get(file.key) ?? { status: 'unrecorded' as const })
        : { status: 'unknown' as const },
      view,
    }))
  })
}

/**
 * Admits each file a run produced on its own, classified by the storage key the run recorded, and
 * returns the ids admitted. A caller no gate observes gets every id back without a provenance read.
 */
export async function admitRunFiles(
  principal: Principal,
  workspaceId: string,
  files: readonly UserFile[],
  view: ContentView
): Promise<Set<string>> {
  const admitted = await admitRunFileItems(principal, workspaceId, files, view)
  return new Set(admitted.map((file) => file.id))
}

/**
 * Every file descriptor in an output that inlines bytes, once per storage key. Not deduplicated by
 * id: an earlier descriptor of the same file without bytes must not hide a later one with them.
 */
function collectInlinedFiles(value: unknown, files: Map<string, UserFile>, seen: WeakSet<object>) {
  const pending: Iterator<unknown>[] = [[value].values()]
  while (pending.length > 0) {
    const iterator = pending[pending.length - 1]
    const next = iterator.next()
    if (next.done) {
      pending.pop()
      continue
    }
    const current = next.value
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    if (isUserFileWithMetadata(current)) {
      if (typeof current.base64 === 'string' && !files.has(current.key)) {
        files.set(current.key, current)
      }
      continue
    }
    pending.push((Array.isArray(current) ? current : Object.values(current)).values())
  }
}

function withoutUnadmittedBase64(value: unknown, admittedKeys: ReadonlySet<string>): unknown {
  const seen = new WeakMap<object, unknown>()
  const pending: {
    target: object
    entries: Iterator<[string | number, unknown]>
  }[] = []
  const copy = (current: unknown): unknown => {
    if (!current || typeof current !== 'object') return current
    const copied = seen.get(current)
    if (copied !== undefined) return copied
    if (isUserFileWithMetadata(current)) {
      if (typeof current.base64 !== 'string' || admittedKeys.has(current.key)) return current
      const { base64: _withheld, ...described } = current
      seen.set(current, described)
      return described
    }
    /** Register the copy before scheduling its children so shared and cyclic references agree. */
    if (Array.isArray(current)) {
      const items: unknown[] = []
      seen.set(current, items)
      pending.push({ target: items, entries: current.entries() })
      return items
    }
    /** Non-data objects keep their identity; refused bytes inside one cannot be removed safely. */
    const prototype = Object.getPrototypeOf(current)
    if (prototype !== Object.prototype && prototype !== null) {
      const held = new Map<string, UserFile>()
      collectInlinedFiles(current, held, new WeakSet())
      for (const file of held.values()) {
        if (!admittedKeys.has(file.key)) throw new ContentRefusedError('execution-file')
      }
      return current
    }
    const record: Record<string, unknown> = prototype === null ? Object.create(null) : {}
    seen.set(current, record)
    pending.push({ target: record, entries: Object.entries(current).values() })
    return record
  }
  const result = copy(value)
  while (pending.length > 0) {
    const frame = pending[pending.length - 1]
    const next = frame.entries.next()
    if (next.done) {
      pending.pop()
      continue
    }
    const [key, item] = next.value
    /** An own `__proto__` key remains data rather than replacing the copied object's prototype. */
    Object.defineProperty(frame.target, key, {
      value: copy(item),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return result
}

/**
 * Keeps an output's inlined file bytes only for files admitted on their own; another file keeps
 * its descriptor without `base64`, and stays downloadable through the run's file route, which is
 * gated per file. Inlined base64 is opaque to text redaction.
 */
export async function withholdUnadmittedInlineFiles<T>(
  principal: Principal,
  workspaceId: string,
  value: T
): Promise<T> {
  /** Only Chat is classified; every other caller keeps its output unwalked. */
  if (!isCopilotPrincipal(principal)) {
    await admitContent(principal, [])
    return value
  }
  const found = new Map<string, UserFile>()
  collectInlinedFiles(value, found, new WeakSet())
  const inlined = [...found.values()]
  const admitted = await admitRunFileItems(principal, workspaceId, inlined, 'opaque')
  if (admitted.length === inlined.length) return value
  const admittedKeys = new Set(admitted.map((file) => file.key))
  return withoutUnadmittedBase64(value, admittedKeys) as T
}

/**
 * Inline base64 a streamed run emits cannot be withheld per file once it is on the wire, so Chat
 * receives inline file bytes only from a run that returns its whole result at once; every file
 * stays downloadable through the run's file route, gated per file.
 */
export function inlinesRunFiles(
  principal: Principal,
  requested: boolean | undefined,
  mode: string | undefined
): boolean | undefined {
  /** An omitted flag inlines by default downstream, so Chat's streamed runs pin it off. */
  return mode !== 'sync' && isCopilotPrincipal(principal) ? false : requested
}
