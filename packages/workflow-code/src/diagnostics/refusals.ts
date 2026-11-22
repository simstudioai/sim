/**
 * Refusals: which findings refuse a write, and how a refused write is classed.
 *
 * Which compile warnings an apply refuses on the blocks an edit wrote. A warning stays a warning
 * on what the stored workflow already holds, so a workflow saved with one still applies
 * unchanged; on a block the edit added or changed it fails at run time, so the apply refuses it
 * under an `E_APPLY_*` code. The server's source evaluation and the CLI's offline check both call
 * {@link refuseEditedFindings} with what each knows the edit changed, so they cannot disagree.
 *
 * How a refusal is classed ({@link refusalClass}): its HTTP status on the server and its exit
 * code in the CLI, the same for workflow and workspace source.
 */
import { SOURCE_ENTRY_FILE } from '../limits'
import { type CompileDiagnosticCode, MAX_ERRORS } from './codes'
import { diagnostic } from './factory'
import type { LocatedDiagnostic } from './frame'

/** How a refused write is classed: its HTTP status on the server, its exit code in the CLI. */
export type RefusalClass = 'conflict' | 'locked' | 'payload_too_large' | 'validation'

/** The error codes of each class but `validation`, which is every other error. */
export interface RefusalCodes {
  /** What the write was based on changed since it was read (`409`). */
  conflict: readonly string[]
  /** The target is locked against the change (`423`). */
  locked: readonly string[]
  /** A size, count or nesting limit (`413`). */
  payload_too_large: readonly string[]
}

/** The workflow vocabulary's classed codes, which every vocabulary shares. */
const REFUSAL_CODES: RefusalCodes = {
  conflict: ['E_APPLY_STALE'],
  locked: [],
  payload_too_large: ['E_LIMIT_EXCEEDED'],
}

/**
 * The classifier of a vocabulary that adds `extra` classed codes to the workflow vocabulary's: the
 * class of a refusal with these error codes, the most specific first (a conflict, then a lock,
 * then a size limit), else `validation`.
 */
export function refusalClassifier(
  extra: Partial<RefusalCodes> = {}
): (codes: Iterable<string>) => RefusalClass {
  const classed = (refusal: keyof RefusalCodes) =>
    new Set([...REFUSAL_CODES[refusal], ...(extra[refusal] ?? [])])
  const order = (['conflict', 'locked', 'payload_too_large'] as const).map(
    (refusal) => [refusal, classed(refusal)] as const
  )
  return (codes) => {
    const present = new Set(codes)
    for (const [refusal, members] of order) {
      for (const code of members) if (present.has(code)) return refusal
    }
    return 'validation'
  }
}

/** The class of a workflow source refusal with these error codes (see {@link refusalClassifier}). */
export const refusalClass = refusalClassifier()

/** The error codes an edited block's warning is refused under. */
export type EditRefusalCode =
  | 'E_APPLY_UNRESOLVED_REF'
  | 'E_APPLY_REF_OUT_OF_SCOPE'
  | 'E_APPLY_LOOP_CONDITION_SYNTAX'
  | 'E_APPLY_CODE_FILE_REF_SYNTAX'
  | 'E_APPLY_INVALID_SUBBLOCK_FIELD'
  | 'E_APPLY_INVALID_BLOCK_TYPE'
  | 'E_APPLY_TYPE_NOT_ADDABLE'

/** What an edit changed, as the caller can tell it. */
export interface EditedBlocks {
  /** Whether the edit added the block or changed it in any way, a move included. */
  changed(blockKey: string): boolean
  /**
   * Whether the edit changed the function code the block runs from code file `file`: the file's
   * text, or which file the block runs. A block runs one file, so a caller holding the block's
   * code before and after may compare that alone.
   */
  codeEdited(blockKey: string, file: string): boolean
  /**
   * Whether the edit sets field `param` of the changed block `blockKey`: the server's field gate
   * judges only those. A caller that cannot tell (an offline check holds no stored values) leaves
   * it out, and every field of a changed block counts as set.
   */
  paramChanged?(blockKey: string, param: string): boolean
}

/** A warning code and the error an apply refuses it under. */
type RefusalRule = [warning: CompileDiagnosticCode, refusal: EditRefusalCode]

/**
 * An iteration field read outside its container (`W_REF_OUT_OF_SCOPE`), or a loop condition that
 * is not a JavaScript expression (`W_LOOP_CONDITION_SYNTAX`), refused in any file on a block the
 * edit changed, or in a code file the edit changed.
 */
const CHANGED_BLOCK_REFUSALS: ReadonlyMap<string, EditRefusalCode> = new Map([
  ['W_REF_OUT_OF_SCOPE', 'E_APPLY_REF_OUT_OF_SCOPE'],
  ['W_LOOP_CONDITION_SYNTAX', 'E_APPLY_LOOP_CONDITION_SYNTAX'],
] satisfies RefusalRule[])

/**
 * In `workflow.ts` on a field the edit set ({@link EditedBlocks.paramChanged}) of a block it
 * changed: a dropdown value none of its options names, which the server's field gate refuses. A
 * value the stored block already holds outside its options prints as `raw()`, which the compile
 * does not check, and one written bare again is not a field the edit set, so only a value the
 * author changed is refused. `operation` is left out: an unknown one is already an error, and its
 * warning means the stored block holds a retired operation, which the gate keeps.
 */
const PARAM_REFUSALS: ReadonlyMap<string, EditRefusalCode> = new Map([
  ['W_UNKNOWN_OPTION', 'E_APPLY_INVALID_SUBBLOCK_FIELD'],
] satisfies RefusalRule[])

/**
 * In `workflow.ts` on a block the edit changed: a path no output of the block has, or a literal
 * `<name.path>` whose head names no block, which the server's lint refuses as a dangling reference,
 * or a new block of a type the catalog does not hold or keeps only for blocks already using it,
 * which its placement gate refuses.
 */
const ENTRY_REFUSALS: ReadonlyMap<string, EditRefusalCode> = new Map([
  ['W_UNKNOWN_OUTPUT_PATH', 'E_APPLY_UNRESOLVED_REF'],
  ['W_UNRESOLVED_REF', 'E_APPLY_UNRESOLVED_REF'],
  ['W_UNKNOWN_BLOCK_TYPE', 'E_APPLY_INVALID_BLOCK_TYPE'],
  ['W_TYPE_NOT_ADDABLE', 'E_APPLY_TYPE_NOT_ADDABLE'],
] satisfies RefusalRule[])

/**
 * In a function code file whose text the edit changed: a `$ref` naming no block or variable, or a
 * path no output of its block has, or a `$ref`/`$env` in a Python or shell file, which runs as
 * text.
 */
const CODE_FILE_REFUSALS: ReadonlyMap<string, EditRefusalCode> = new Map([
  ['W_UNRESOLVED_REF', 'E_APPLY_UNRESOLVED_REF'],
  ['W_UNKNOWN_OUTPUT_PATH', 'E_APPLY_UNRESOLVED_REF'],
  ['W_CODE_FILE_REF_SYNTAX', 'E_APPLY_CODE_FILE_REF_SYNTAX'],
] satisfies RefusalRule[])

/**
 * Every warning code {@link refuseEditedFindings} may refuse: the compile keeps one of each code,
 * block and file that its caps leave out (`CompileResult.withheld`), so a cap never hides a
 * refusal.
 */
export const REFUSABLE_WARNING_CODES: ReadonlySet<string> = new Set(
  [CHANGED_BLOCK_REFUSALS, PARAM_REFUSALS, ENTRY_REFUSALS, CODE_FILE_REFUSALS].flatMap((rules) => [
    ...rules.keys(),
  ])
)

/** The rules' error codes with the warning each refuses, for help text. */
export const EDIT_REFUSALS: ReadonlyArray<{
  warning: string
  refusal: EditRefusalCode
  where: 'changed block' | 'workflow.ts' | 'edited code file'
}> = [
  ...[...CHANGED_BLOCK_REFUSALS].map(([warning, refusal]) => ({
    warning,
    refusal,
    where: 'changed block' as const,
  })),
  ...[...PARAM_REFUSALS].map(([warning, refusal]) => ({
    warning,
    refusal,
    where: 'workflow.ts' as const,
  })),
  ...[...ENTRY_REFUSALS].map(([warning, refusal]) => ({
    warning,
    refusal,
    where: 'workflow.ts' as const,
  })),
  ...[...CODE_FILE_REFUSALS].map(([warning, refusal]) => ({
    warning,
    refusal,
    where: 'edited code file' as const,
  })),
]

/**
 * The clause a warning ends with to say an apply saves the value anyway (`; it is kept as
 * written.`), dropped from a warning raised to an error, which nothing saves.
 */
const KEPT_AS_WRITTEN = /[;,] (?:it|the value|the text) is kept as written\.$/

/** `message` without its {@link KEPT_AS_WRITTEN} clause, for a warning raised to an error. */
export function raisedMessage(message: string): string {
  return message.replace(KEPT_AS_WRITTEN, '.')
}

/**
 * What deciding a refusal reads of a finding: a listed or withheld diagnostic, or a counted
 * omitted one (which keeps its file and field).
 */
interface RefusalSubject {
  code: string
  severity: string
  blockKey?: string
  param?: string
  span: { file: string }
}

/** The code the apply refuses `finding` under, given what the edit changed; none when it stays. */
function refusalOf(finding: RefusalSubject, edit: EditedBlocks): EditRefusalCode | undefined {
  if (finding.severity !== 'warning' || finding.blockKey === undefined) return undefined
  const { blockKey, span } = finding
  const inEntryFile = span.file === SOURCE_ENTRY_FILE
  const onChanged = CHANGED_BLOCK_REFUSALS.get(finding.code)
  if (onChanged) {
    const edited = edit.changed(blockKey) || (!inEntryFile && edit.codeEdited(blockKey, span.file))
    return edited ? onChanged : undefined
  }
  const onParam = PARAM_REFUSALS.get(finding.code)
  if (onParam) {
    const { param } = finding
    if (!inEntryFile || param === undefined || param === 'operation') return undefined
    if (!edit.changed(blockKey)) return undefined
    return (edit.paramChanged?.(blockKey, param) ?? true) ? onParam : undefined
  }
  if (inEntryFile) {
    const inEntry = ENTRY_REFUSALS.get(finding.code)
    return inEntry && edit.changed(blockKey) ? inEntry : undefined
  }
  const inCode = CODE_FILE_REFUSALS.get(finding.code)
  return inCode && edit.codeEdited(blockKey, span.file) ? inCode : undefined
}

/** Whether the apply refuses `finding` (a compile warning), given what the edit changed. */
export function refusesEdited(finding: RefusalSubject, edit: EditedBlocks): boolean {
  return refusalOf(finding, edit) !== undefined
}

/**
 * A compile's findings with every warning the apply refuses on an edited block raised to its
 * error code (see the module doc). `withheld`, the refusable warnings the compile's caps left
 * out, join the result only when refused, so a refusal never depends on where a cap fell. They
 * are listed only up to what remains of {@link MAX_ERRORS}; the rest are counted in one
 * `E_TOO_MANY_ERRORS`, so the result keeps the compile's error bound and still holds an error
 * whenever any finding is refused.
 */
export function refuseEditedFindings<D extends LocatedDiagnostic>(
  compiled: { diagnostics: readonly D[]; withheld: readonly D[] },
  edit: EditedBlocks
): Array<D | LocatedDiagnostic> {
  const refused = (finding: D): LocatedDiagnostic | undefined => {
    const code = refusalOf(finding, edit)
    return code === undefined
      ? undefined
      : { ...finding, ...diagnostic(code, raisedMessage(finding.message)) }
  }
  const listed: Array<D | LocatedDiagnostic> = compiled.diagnostics.map(
    (finding) => refused(finding) ?? finding
  )
  const extra = compiled.withheld.filter((finding) => refusalOf(finding, edit) !== undefined)
  const budget = Math.max(
    0,
    MAX_ERRORS - listed.filter((finding) => finding.severity === 'error').length
  )
  const raised = extra.slice(0, budget).flatMap((finding) => refused(finding) ?? [])
  if (extra.length <= budget) return [...listed, ...raised]
  const [first] = extra.slice(budget)
  const omitted = extra.length - budget
  const summary: LocatedDiagnostic<'E_TOO_MANY_ERRORS'> = diagnostic(
    'E_TOO_MANY_ERRORS',
    `${omitted} more edited ${omitted === 1 ? 'finding is' : 'findings are'} refused, as the ones listed are. The next: ${raisedMessage(first.message)}`,
    {
      hint: 'Fix the errors listed and check again to see the rest.',
      span: first.span,
      ...(first.frame === undefined ? {} : { frame: first.frame }),
      ...(first.blockKey === undefined ? {} : { blockKey: first.blockKey }),
    }
  )
  return [...listed, ...raised, summary]
}
