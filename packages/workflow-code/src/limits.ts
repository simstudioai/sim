import { utf8ByteLength } from '@sim/utils/paste'

/**
 * The limits workflow source shares across reading and writing. A get refuses to print a workflow
 * over them, and compile, the source contracts and the apply body cap enforce the same numbers, so
 * anything a get returns can be applied back unchanged.
 *
 * One byte cap covers every file together and none caps a single file: function code moves
 * between the entry (inline) and code files (files mode), so a per-file cap would refuse one
 * printing of a workflow and accept the other. The Code tab reads inline, so its one file may use
 * the whole budget.
 *
 * Files mode never needs more files than blocks: the printer writes at most one code file per
 * block, so `maxFiles` (the entry plus one per block) always holds a workflow within `maxBlocks`,
 * and a get never has to fall back to inline code for an overflow.
 *
 * Client-safe: no parser or catalog imports, so contracts can read it.
 */
export const SOURCE_LIMITS = {
  /** Blocks in one workflow. Mirrors the v2 graph cap (`MAX_WORKFLOW_GRAPH_BLOCKS`). */
  maxBlocks: 2_000,
  /** Edges in one workflow. Mirrors the v2 graph cap (`MAX_WORKFLOW_GRAPH_EDGES`). */
  maxEdges: 10_000,
  /** Variables in one workflow, so a lock holds at most this many variable entries. */
  maxVariables: 2_000,
  /** Files in one source: `workflow.ts` plus one code file per block. */
  maxFiles: 2_001,
  /** UTF-8 bytes of every file together, the entry included. */
  maxTotalBytes: 4_000_000,
  /**
   * Nesting depth: of the entry's syntax tree and brackets, and of each JavaScript code file's
   * brackets. A 200-block workflow nests under 20 levels. A get checks its printed files with
   * `sourceDepthOverflow` (`compile/parse.ts`), which needs the parser this module avoids.
   */
  maxDepth: 200,
} as const

/**
 * Body cap for a request carrying source files: every file at its limit, doubled for JSON string
 * escaping (quotes, backslashes, newlines and tabs each escape to two bytes), plus room for a lock
 * of `maxBlocks` block and `maxVariables` variable entries.
 */
export const SOURCE_REQUEST_MAX_BYTES = 2 * SOURCE_LIMITS.maxTotalBytes + 2_000_000

/** The entry file every source holds; function-code files sit beside it. */
export const SOURCE_ENTRY_FILE = 'workflow.ts'

/** The directory the printer writes function-code files under (`functions/<ident>.js`). */
export const SOURCE_CODE_DIR = 'functions'

/** A source directory's identity lock (`WorkflowLockV1`), beside the entry file. */
export const SOURCE_LOCK_FILE = '.sim/lock.json'

/** A source directory's base (`SourceBase`): where and at which fingerprint it was read. */
export const SOURCE_BASE_FILE = '.sim/base.json'

/**
 * Each function language's code file extension, which is also its template tag (`js```). The
 * languages are `CodeLanguage` (apps/sim/lib/execution/languages.ts).
 */
export const CODE_FILE_EXTENSIONS = {
  javascript: 'js',
  python: 'py',
  shell: 'sh',
} as const

/**
 * A function code file's path in a workflow directory, from the directory root:
 * `functions/<name>.<js|py|sh>`, the name letters, digits, `_`, `$`, `-` and inner dots (never a
 * leading one). The one rule the compiler (`E_CODE_FILE_PATH`), the printer and the CLI (on what
 * it sends and what it writes) share, so a name one accepts the others never refuse after a
 * write was stored.
 */
const CODE_FILE_PATH = new RegExp(
  `^${SOURCE_CODE_DIR}/[A-Za-z0-9_$-][A-Za-z0-9_.$-]*\\.(?:${Object.values(CODE_FILE_EXTENSIONS).join('|')})$`
)

/** Whether `path` (from the workflow directory root) is a code file path a source may name. */
export function isCodeFilePath(path: string): boolean {
  return CODE_FILE_PATH.test(path)
}

/** One size limit a source exceeds, with the measured value. */
export interface SourceLimitExcess {
  limit: 'maxBlocks' | 'maxEdges' | 'maxVariables' | 'maxFiles' | 'maxTotalBytes'
  actual: number
  max: number
}

/**
 * Every size limit a printed source of a workflow with `counts` blocks, edges and variables
 * exceeds, in limit order; empty when it fits. Depth is `sourceDepthOverflow`'s.
 */
export function sourceLimitExcesses(
  files: Readonly<Record<string, string>>,
  counts: { blocks: number; edges: number; variables: number }
): SourceLimitExcess[] {
  const excesses: SourceLimitExcess[] = []
  if (counts.blocks > SOURCE_LIMITS.maxBlocks) {
    excesses.push({ limit: 'maxBlocks', actual: counts.blocks, max: SOURCE_LIMITS.maxBlocks })
  }
  if (counts.edges > SOURCE_LIMITS.maxEdges) {
    excesses.push({ limit: 'maxEdges', actual: counts.edges, max: SOURCE_LIMITS.maxEdges })
  }
  if (counts.variables > SOURCE_LIMITS.maxVariables) {
    excesses.push({
      limit: 'maxVariables',
      actual: counts.variables,
      max: SOURCE_LIMITS.maxVariables,
    })
  }
  const paths = Object.keys(files)
  if (paths.length > SOURCE_LIMITS.maxFiles) {
    excesses.push({ limit: 'maxFiles', actual: paths.length, max: SOURCE_LIMITS.maxFiles })
  }
  let total = 0
  for (const path of paths) total += utf8ByteLength(files[path])
  if (total > SOURCE_LIMITS.maxTotalBytes) {
    excesses.push({ limit: 'maxTotalBytes', actual: total, max: SOURCE_LIMITS.maxTotalBytes })
  }
  return excesses
}
