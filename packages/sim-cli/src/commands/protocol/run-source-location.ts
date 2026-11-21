/**
 * Where in a workflow source directory a failed run failed: the run names the failing block by id,
 * the directory's lock binds that id to the block's key, const and function file, and a function
 * block's error names its line, which the stored code keeps one to one with the file.
 */
import { toRecord } from '@sim/utils/object'
import { escapeRegExp } from '@sim/utils/string'
import { parseWorkflowLock } from '@sim/workflow-code'
import { SOURCE_BASE_FILE, SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { annotationLine, annotationPath, printAnnotations } from '#sim-cli/output/github-actions'
import { printError } from '#sim-cli/output/io'
import { blockLabel } from './deployed-urls'
import { readPreviousLock, readSourceJson, readSourceText } from './source-dir'

/** A failed block, as the source directory names it. */
export interface RunFailureSite {
  /** The file to open (relative to the working directory): the block's function file, else the entry. */
  file: string
  line: number | null
  /** The block's key, and its const when it differs: `normalize`, or `leadin (hook)`. */
  block: string
  /** Where the entry file declares a block whose code is in its own file, when found. */
  declaredAt: string | null
}

/** The line a function block's error names (`Type Error: Line 3: …`), else `null`. */
function errorLine(message: string): number | null {
  const match = /\bLine (\d+)\b/.exec(message)
  return match ? Number(match[1]) : null
}

/** The 1-based line of `const <ident> =` in `entry`, else `null`. */
function declarationLine(entry: string, ident: string): number | null {
  const pattern = new RegExp(`^\\s*const\\s+${escapeRegExp(ident)}\\s*=`)
  const index = entry.split('\n').findIndex((line) => pattern.test(line))
  return index === -1 ? null : index + 1
}

/**
 * Where the run's failure sits in the workflow source directory `dir`: `null` when the error names
 * no block, the directory holds another workflow's source, or its lock does not bind the block.
 */
export async function runFailureSite(
  dir: string,
  workflowId: string,
  error: unknown
): Promise<RunFailureSite | null> {
  const { blockId, message } = toRecord(error)
  if (typeof blockId !== 'string') return null
  if (toRecord(await readSourceJson(dir, SOURCE_BASE_FILE)).workflowId !== workflowId) return null
  const { lock } = parseWorkflowLock(await readPreviousLock(dir))
  const bound = Object.entries(lock?.blocks ?? {}).find(([, entry]) => entry.id === blockId)
  if (!bound) return null
  const [key, entry] = bound
  const block = blockLabel(key, entry.ident)
  const entryText = await readSourceText(dir, SOURCE_ENTRY_FILE)
  const declared = entryText === null ? null : declarationLine(entryText, entry.ident)
  const entryPath = annotationPath(dir, SOURCE_ENTRY_FILE)
  if (entry.codeFile !== undefined) {
    return {
      file: annotationPath(dir, entry.codeFile),
      line: typeof message === 'string' ? errorLine(message) : null,
      block,
      declaredAt: declared === null ? null : `${entryPath}:${declared}`,
    }
  }
  return { file: entryPath, line: declared, block, declaredAt: null }
}

/**
 * Prints where a failed run failed in `dir` (on stderr, and as a GitHub Actions annotation in a
 * job), or that `dir` cannot say.
 */
export async function printRunFailureSite(
  dir: string,
  workflowId: string,
  error: unknown
): Promise<void> {
  const site = await runFailureSite(dir, workflowId, error)
  if (!site) {
    printError(
      `${dir} does not bind the block that failed (another workflow's source, or a block added since the get), so the failure is not mapped to a source line.`
    )
    return
  }
  const where = `${site.file}${site.line === null ? '' : `:${site.line}`}`
  const declared = site.declaredAt ? `, declared at ${site.declaredAt}` : ''
  const message = toRecord(error).message
  const text = typeof message === 'string' ? message : 'The block failed.'
  printError(`${where}: ${text} (block ${site.block}${declared})`)
  printAnnotations([
    annotationLine('error', text, {
      file: site.file,
      line: site.line ?? undefined,
      title: `Run failed in ${site.block}`,
    }),
  ])
}
