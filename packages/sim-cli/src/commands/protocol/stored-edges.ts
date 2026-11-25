import { isRecordLike, toRecord } from '@sim/utils/object'
import {
  type BlockCatalog,
  type CanonicalBlock,
  type ChildResultNode,
  type ChildResults,
  type CompileResult,
  calledWorkflowKeys,
  compiledResultNode,
  compileWorkflow,
  folderCompileInput,
  parseWorkflowLock,
  resolveChildResults,
  type StoredEdgeRef,
  setOwn,
  stableStringify,
  type UntypedJsonField,
} from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE, SOURCE_LOCK_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS } from '@sim/workspace-code'
import type { OperationClient } from '../../runtime/called-operations'
import { digest, readSourceJson, SOURCE_STORED_EDGES_FILE } from './source-dir'
import { cachedCatalogByHash, loadWorkflowCatalog } from './source-tree'
import type { Diagnostic } from './source-ui'

/** A printed source as a get, apply or create answers it. */
interface PrintedAnswer {
  files: Record<string, string>
  lock: unknown
  base: unknown
}

/** A digest of one compiled block, to tell a block an edit changed from one it left alone. */
export function blockDigest(block: CanonicalBlock): string {
  return digest(stableStringify(block))
}

type CompileInput = Parameters<typeof compileWorkflow>[0]

/**
 * `compiled`, the compile of `input`, as `childResults` type it: the same compile when none types
 * a call it makes, else `input` compiled again with them.
 */
export function compiledWithChildResults(
  input: CompileInput,
  compiled: CompileResult,
  childResults: ChildResults | undefined
): CompileResult {
  if (!childResults || childResults.size === 0) return compiled
  const { workflow } = compiled
  if (workflow && !calledWorkflowKeys(workflow).some((key) => childResults.has(key))) {
    return compiled
  }
  return compileWorkflow({ ...input, childResults })
}

/** What a printed source compiles from against `catalog`, or `null` without an entry or lock. */
function printedInput(answer: PrintedAnswer, catalog: BlockCatalog): CompileInput | null {
  const entry = answer.files[SOURCE_ENTRY_FILE]
  const { lock } = parseWorkflowLock(answer.lock)
  return entry !== undefined && lock ? folderCompileInput(entry, answer.files, lock, catalog) : null
}

/**
 * The `.sim/stored-edges.json` write (at `folder`) of a printed source compiled as `compiled`: its
 * edges, its JSON fields holding untyped references, and a digest of each block
 * ({@link blockDigest}, by key), tagged with its base fingerprint.
 * `null` when the answer has no fingerprint; the record left on disk then names an older
 * fingerprint, which a check ignores.
 */
function storedEdgesRecord(
  answer: PrintedAnswer,
  { edges, workflow, untypedJsonFields }: CompileResult,
  folder: string
): readonly [string, string] | null {
  const { fingerprint } = toRecord(answer.base)
  if (typeof fingerprint !== 'string') return null
  return [
    `${folder}${SOURCE_STORED_EDGES_FILE}`,
    `${JSON.stringify(
      {
        version: 1,
        fingerprint,
        edges,
        untypedJsonFields,
        ...(workflow
          ? {
              blocks: Object.fromEntries(
                Object.entries(workflow.blocks).map(([key, block]) => [key, blockDigest(block)])
              ),
            }
          : {}),
      },
      null,
      2
    )}\n`,
  ]
}

/**
 * A printed source of one workflow compiled against `catalog` (the one it was printed with) and
 * typed as it was printed: each child call by `childResults`, which a workflow folder of a
 * workspace directory takes from its workspace directory and a workflow directory of its own has
 * none of. A check compiles it the same way, so a block it reports changed is one an edit
 * changed. `null` when the answer has no entry or lock, or nothing to compile or type it with
 * (`childResults` `null`: the workspace directory could not be read).
 */
export function compilePrinted(
  answer: PrintedAnswer,
  catalog: BlockCatalog | null,
  childResults?: ChildResults | null
): CompileResult | null {
  if (childResults === null) return null
  const input = catalog && printedInput(answer, catalog)
  return input ? compileWorkflow({ ...input, childResults }) : null
}

/**
 * The `.sim/stored-edges.json` write for a printed source of one workflow from its
 * {@link compilePrinted} compile (`null` when it has none, or the answer no fingerprint); the
 * record left on disk then names an older fingerprint, which a check ignores.
 */
export function storedEdgesOf(
  answer: PrintedAnswer,
  compiled: CompileResult | null
): readonly [string, string] | null {
  return compiled ? storedEdgesRecord(answer, compiled, '') : null
}

/** {@link storedEdgesOf} the {@link compilePrinted} compile of `answer`. */
export function storedEdgesWrite(
  answer: PrintedAnswer,
  catalog: BlockCatalog | null,
  childResults?: ChildResults | null
): readonly [string, string] | null {
  return storedEdgesOf(answer, compilePrinted(answer, catalog, childResults))
}

/**
 * The findings of a printed source's compile that the server's read does not report and that fail
 * a run reaching them after the block ran: an output path no block produces. `prefix` goes before
 * each file path (`workflows/<key>/` in a workspace directory).
 */
export function runFailingFindings(compiled: CompileResult | null, prefix = ''): Diagnostic[] {
  return (compiled?.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.code === 'W_UNKNOWN_OUTPUT_PATH')
    .map(({ code, severity, message, hint, blockKey, span }) => ({
      code,
      severity,
      message,
      ...(hint !== undefined ? { hint } : {}),
      ...(blockKey !== undefined ? { blockKey } : {}),
      file: `${prefix}${span.file}`,
      line: span.line,
      column: span.column,
    }))
}

/** The workflow folders a workspace answer's files hold, by key, each as a printed source. */
function printedWorkflowFolders(files: Record<string, string>): Map<string, PrintedAnswer> {
  const folders = new Map<string, PrintedAnswer>()
  const prefix = `${KIND_DIRS.workflow}/`
  for (const [path, text] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue
    const slash = path.indexOf('/', prefix.length)
    if (slash < 0) continue
    const key = path.slice(prefix.length, slash)
    const relative = path.slice(slash + 1)
    const folder = folders.get(key) ?? { files: {}, lock: undefined, base: undefined }
    if (relative === SOURCE_LOCK_FILE) folder.lock = parseJson(text)
    else if (relative === SOURCE_BASE_FILE) folder.base = parseJson(text)
    else setOwn(folder.files, relative, text)
    folders.set(key, folder)
  }
  return folders
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The stored-edges records of a workspace answer, and the folders left without one. */
export interface WorkflowFolderRecords {
  records: Array<readonly [string, string]>
  /** {@link runFailingFindings} of every folder, by its path in the workspace directory. */
  runFindings: Diagnostic[]
  /** Folder keys whose catalog could not be fetched: their record is skipped, not failed. */
  unrecorded: string[]
}

/**
 * The `.sim/stored-edges.json` write of each workflow folder a workspace get or apply answered
 * with, each compiled against the catalog its base names and typed as the server printed it: a
 * call by the result fields of the folder it calls, resolved through chains
 * ({@link resolveChildResults}), as a check types it. A workflow holding a type the workspace
 * catalog lacks was printed with its own catalog: one not cached yet is fetched, once per
 * distinct hash, and cached, so an offline check compiles that folder against it too. The records are a cache fill, never part of the write: a
 * catalog fetch that fails skips the folders printed with that catalog (named in `unrecorded`)
 * rather than failing a write the server already committed.
 */
export async function workflowFolderRecords(
  client: OperationClient<'getSourceCatalog'>,
  workspaceId: string,
  workspaceCatalog: BlockCatalog,
  files: Record<string, string>
): Promise<WorkflowFolderRecords> {
  const folders = printedWorkflowFolders(files)
  const uncached = new Map<string, string>()
  for (const { base } of folders.values()) {
    const { workflowId, catalogHash } = toRecord(base)
    if (typeof workflowId !== 'string' || typeof catalogHash !== 'string') continue
    if (catalogHash === workspaceCatalog.hash || cachedCatalogByHash(catalogHash)) continue
    if (!uncached.has(catalogHash)) uncached.set(catalogHash, workflowId)
  }
  const fetched = new Map<string, BlockCatalog>()
  for (const [catalogHash, workflowId] of uncached) {
    const catalog = await loadWorkflowCatalog(client, workspaceId, workflowId).catch(() => null)
    if (catalog) fetched.set(catalogHash, catalog)
  }
  const compiledFolders: Array<{
    key: string
    folder: PrintedAnswer
    input: CompileInput
    compiled: CompileResult
  }> = []
  const nodes = new Map<string, ChildResultNode>()
  const unrecorded: string[] = []
  for (const [key, folder] of folders) {
    const { catalogHash } = toRecord(folder.base)
    const catalog =
      catalogHash === workspaceCatalog.hash
        ? workspaceCatalog
        : typeof catalogHash === 'string'
          ? (fetched.get(catalogHash) ?? cachedCatalogByHash(catalogHash))
          : null
    if (typeof catalogHash === 'string' && uncached.has(catalogHash) && !catalog) {
      unrecorded.push(key)
      continue
    }
    const input = catalog && printedInput(folder, catalog)
    if (!input) continue
    const compiled = compileWorkflow(input)
    compiledFolders.push({ key, folder, input, compiled })
    const node = compiledResultNode(input, compiled)
    if (node) nodes.set(key, node)
  }
  const childResults = resolveChildResults(nodes)
  const records: Array<readonly [string, string]> = []
  const runFindings: Diagnostic[] = []
  for (const { key, folder, input, compiled } of compiledFolders) {
    const typed = compiledWithChildResults(input, compiled, childResults)
    const prefix = `${KIND_DIRS.workflow}/${key}/`
    const record = storedEdgesRecord(folder, typed, prefix)
    if (record) records.push(record)
    runFindings.push(...runFailingFindings(typed, prefix))
  }
  return { records, runFindings, unrecorded }
}

/**
 * The warning for workflow folders {@link workflowFolderRecords} could not record, or `null`.
 * Their edges are unrecorded, so an offline check of each one compiles without its stored edges
 * until the next get records them.
 */
export function unrecordedFoldersWarning(unrecorded: readonly string[]): string | null {
  if (unrecorded.length === 0) return null
  return `Warning: could not fetch the block catalog of ${unrecorded.map((key) => `${KIND_DIRS.workflow}/${key}`).join(', ')}, so its stored edges are not recorded; everything else was saved. The next \`sim workspaces source get\` records them.`
}

function isStoredEdge(value: unknown): value is StoredEdgeRef {
  return (
    isRecordLike(value) &&
    typeof value.from === 'string' &&
    typeof value.port === 'string' &&
    typeof value.to === 'string'
  )
}

function isUntypedJsonField(value: unknown): value is UntypedJsonField {
  return (
    isRecordLike(value) &&
    typeof value.block === 'string' &&
    typeof value.param === 'string' &&
    typeof value.value === 'string' &&
    Array.isArray(value.refs) &&
    value.refs.every((ref) => typeof ref === 'string')
  )
}

/**
 * The stored-edges record of the base `dir` holds now, or an empty record when there is none: no
 * record, or one another base wrote.
 */
async function currentRecord(dir: string): Promise<Record<string, unknown>> {
  const [record, base] = await Promise.all([
    readSourceJson(dir, SOURCE_STORED_EDGES_FILE),
    readSourceJson(dir, SOURCE_BASE_FILE),
  ])
  const { version, fingerprint } = toRecord(record)
  return version === 1 &&
    typeof fingerprint === 'string' &&
    fingerprint === toRecord(base).fingerprint
    ? toRecord(record)
    : {}
}

/**
 * The stored edges recorded for the base `dir` holds now, or `undefined` when none are: no
 * record, one another base wrote, or a malformed one.
 */
export async function readStoredEdges(dir: string): Promise<StoredEdgeRef[] | undefined> {
  const { edges } = await currentRecord(dir)
  return Array.isArray(edges) && edges.every(isStoredEdge) ? edges : undefined
}

/**
 * The JSON fields holding untyped references recorded for the base `dir` holds now (see
 * {@link storedEdgesWrite}), or `undefined` when none are: no record, one another base wrote, or
 * a malformed one.
 */
export async function readStoredUntypedFields(
  dir: string
): Promise<UntypedJsonField[] | undefined> {
  const { untypedJsonFields } = await currentRecord(dir)
  return Array.isArray(untypedJsonFields) && untypedJsonFields.every(isUntypedJsonField)
    ? untypedJsonFields
    : undefined
}

/**
 * The digest of each block of the printed source the record of the base `dir` holds now was
 * written from, by key (see {@link storedEdgesWrite}); `undefined` when there is no such record or
 * it records no blocks.
 */
export async function readStoredBlockDigests(
  dir: string
): Promise<ReadonlyMap<string, string> | undefined> {
  const { blocks } = await currentRecord(dir)
  if (!isRecordLike(blocks)) return undefined
  const digests = new Map<string, string>()
  for (const [key, value] of Object.entries(blocks)) {
    if (typeof value !== 'string') return undefined
    digests.set(key, value)
  }
  return digests
}

/** The stored-edges records of the workflow folders whose base a write removes (`paths`). */
export function removedWorkflowRecords(paths: Iterable<string>): string[] {
  return [...paths].flatMap((path) =>
    path.startsWith(`${KIND_DIRS.workflow}/`) && path.endsWith(`/${SOURCE_BASE_FILE}`)
      ? [`${path.slice(0, -SOURCE_BASE_FILE.length)}${SOURCE_STORED_EDGES_FILE}`]
      : []
  )
}
