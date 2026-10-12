import type { Principal } from '@sim/auth/principal'
import {
  admitContent,
  admitEach,
  ContentRefusedError,
  type ContentView,
  isCopilotPrincipal,
  mustClassifyContent,
} from '@/lib/core/application/content-delivery'
import { collectUserFilesById, isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import { getStoredFileSecretProvenanceByKey } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import type { UserFile } from '@/executor/types'

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
  const admitted = await admitEach(principal, files, async (items) => {
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
  return new Set(admitted.map((file) => file.id))
}

function withoutUnadmittedBase64(
  value: unknown,
  admittedKeys: ReadonlySet<string>,
  seen: WeakMap<object, unknown>
): unknown {
  if (!value || typeof value !== 'object') return value
  const copied = seen.get(value)
  if (copied !== undefined) return copied
  if (isUserFileWithMetadata(value)) {
    if (typeof value.base64 !== 'string' || admittedKeys.has(value.key)) return value
    const { base64: _withheld, ...described } = value
    seen.set(value, described)
    return described
  }
  /** Each copy is registered before its children are walked, so a cycle resolves to the copy. */
  if (Array.isArray(value)) {
    const items: unknown[] = []
    seen.set(value, items)
    for (const item of value) items.push(withoutUnadmittedBase64(item, admittedKeys, seen))
    return items
  }
  /**
   * Only plain data is rebuilt. Another object (a stream, response or date) passes through
   * untouched unless it carries refused inline bytes, which cannot be removed without rebuilding
   * it, so the result is refused instead.
   */
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    for (const file of collectUserFilesById(value).values()) {
      if (typeof file.base64 === 'string' && !admittedKeys.has(file.key)) {
        throw new ContentRefusedError('execution-file')
      }
    }
    return value
  }
  const record: Record<string, unknown> = prototype === null ? Object.create(null) : {}
  seen.set(value, record)
  for (const [key, item] of Object.entries(value)) {
    record[key] = withoutUnadmittedBase64(item, admittedKeys, seen)
  }
  return record
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
  const inlined = [...collectUserFilesById(value).values()].filter(
    (file) => typeof file.base64 === 'string'
  )
  const admittedIds = await admitRunFiles(principal, workspaceId, inlined, 'opaque')
  if (admittedIds.size === inlined.length) return value
  const admittedKeys = new Set(
    inlined.filter((file) => admittedIds.has(file.id)).map((file) => file.key)
  )
  return withoutUnadmittedBase64(value, admittedKeys, new WeakMap()) as T
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
  return mode !== 'sync' && requested && mustClassifyContent(principal) ? false : requested
}
