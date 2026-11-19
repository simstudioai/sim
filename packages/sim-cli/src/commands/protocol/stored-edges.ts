import { isRecordLike, toRecord } from '@sim/utils/object'
import {
  type BlockCatalog,
  compileWorkflow,
  parseWorkflowLock,
  type StoredEdgeRef,
} from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { readSourceJson, SOURCE_STORED_EDGES_FILE } from './source-dir'

/** A printed source as a get, apply or create answers it. */
interface PrintedAnswer {
  files: Record<string, string>
  lock: unknown
  base: unknown
}

/**
 * The `.sim/stored-edges.json` write for a printed source: its edges, compiled against `catalog`
 * (the one it was printed with), tagged with its base fingerprint. `null` when the answer has no
 * fingerprint or entry, or nothing to compile it with; the record left on disk then names an
 * older fingerprint, which a check ignores.
 */
export function storedEdgesWrite(
  answer: PrintedAnswer,
  catalog: BlockCatalog | null
): readonly [string, string] | null {
  const { fingerprint } = toRecord(answer.base)
  const entry = answer.files[SOURCE_ENTRY_FILE]
  const { lock } = parseWorkflowLock(answer.lock)
  if (!catalog || typeof fingerprint !== 'string' || entry === undefined || !lock) return null
  const { edges } = compileWorkflow({
    entry: { path: SOURCE_ENTRY_FILE, text: entry },
    files: new Map(Object.entries(answer.files).filter(([path]) => path !== SOURCE_ENTRY_FILE)),
    catalog,
    sdkMajor: catalog.sdkMajor,
    knownKeys: new Set(Object.keys(lock.blocks)),
    storedUnread: lock,
  })
  return [
    SOURCE_STORED_EDGES_FILE,
    `${JSON.stringify({ version: 1, fingerprint, edges }, null, 2)}\n`,
  ]
}

function isStoredEdge(value: unknown): value is StoredEdgeRef {
  return (
    isRecordLike(value) &&
    typeof value.from === 'string' &&
    typeof value.port === 'string' &&
    typeof value.to === 'string'
  )
}

/**
 * The stored edges recorded for the base `dir` holds now, or `undefined` when none are: no
 * record, one an older CLI or another base wrote, or a malformed one.
 */
export async function readStoredEdges(dir: string): Promise<StoredEdgeRef[] | undefined> {
  const [record, base] = await Promise.all([
    readSourceJson(dir, SOURCE_STORED_EDGES_FILE),
    readSourceJson(dir, SOURCE_BASE_FILE),
  ])
  const { version, fingerprint, edges } = toRecord(record)
  if (
    version !== 1 ||
    typeof fingerprint !== 'string' ||
    fingerprint !== toRecord(base).fingerprint ||
    !Array.isArray(edges) ||
    !edges.every(isStoredEdge)
  ) {
    return undefined
  }
  return edges
}
