/**
 * Which compile warnings an apply refuses on the blocks an edit wrote. A warning stays a warning
 * on what the stored workflow already holds, so a workflow saved with one still applies
 * unchanged; on a block the edit added or changed it fails at run time, so the apply refuses it
 * under an `E_APPLY_*` code. The server's source evaluation and the CLI's offline check both call
 * {@link refuseEditedFindings} with what each knows the edit changed, so they cannot disagree.
 */
import { SOURCE_ENTRY_FILE } from '../limits'
import { type CompileDiagnosticCode, MAX_ERRORS } from './codes'
import type { LocatedDiagnostic } from './frame'

/** The error codes an edited block's warning is refused under. */
export type EditRefusalCode =
  | 'E_APPLY_UNRESOLVED_REF'
  | 'E_APPLY_REF_OUT_OF_SCOPE'
  | 'E_APPLY_CODE_FILE_REF_SYNTAX'

/** What an edit changed, as the caller can tell it. */
export interface EditedBlocks {
  /** Whether the edit added the block or changed it in any way, a move included. */
  changed(blockKey: string): boolean
  /** Whether the edit changed the text of the block's function code file `file`. */
  codeEdited(blockKey: string, file: string): boolean
}

/**
 * An iteration field read outside its container (`W_REF_OUT_OF_SCOPE`), refused in any file on a
 * block the edit changed, or in a code file the edit changed.
 */
const CHANGED_BLOCK_REFUSALS: ReadonlyMap<string, EditRefusalCode> = new Map([
  ['W_REF_OUT_OF_SCOPE', 'E_APPLY_REF_OUT_OF_SCOPE'],
])

/** In `workflow.ts` on a block the edit changed: a path no output of the block has. */
const ENTRY_REFUSALS: ReadonlyMap<string, EditRefusalCode> = new Map([
  ['W_UNKNOWN_OUTPUT_PATH', 'E_APPLY_UNRESOLVED_REF'],
])

/**
 * In a function code file whose text the edit changed: a `$ref` naming no block or variable, or a
 * `$ref`/`$env` in a Python or shell file, which runs as text.
 */
const CODE_FILE_REFUSALS: ReadonlyMap<string, EditRefusalCode> = new Map([
  ['W_UNRESOLVED_REF', 'E_APPLY_UNRESOLVED_REF'],
  ['W_CODE_FILE_REF_SYNTAX', 'E_APPLY_CODE_FILE_REF_SYNTAX'],
])

/**
 * Every warning code {@link refuseEditedFindings} may refuse: the compile keeps one of each code,
 * block and file that its caps leave out (`CompileResult.withheld`), so a cap never hides a
 * refusal.
 */
export const REFUSABLE_WARNING_CODES: ReadonlySet<CompileDiagnosticCode> = new Set([
  'W_REF_OUT_OF_SCOPE',
  'W_UNKNOWN_OUTPUT_PATH',
  'W_UNRESOLVED_REF',
  'W_CODE_FILE_REF_SYNTAX',
])

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

/** The code the apply refuses `finding` under, given what the edit changed; none when it stays. */
function refusalOf(finding: LocatedDiagnostic, edit: EditedBlocks): EditRefusalCode | undefined {
  if (finding.severity !== 'warning' || finding.blockKey === undefined) return undefined
  const { blockKey, span } = finding
  const inEntryFile = span.file === SOURCE_ENTRY_FILE
  const onChanged = CHANGED_BLOCK_REFUSALS.get(finding.code)
  if (onChanged) {
    const edited = edit.changed(blockKey) || (!inEntryFile && edit.codeEdited(blockKey, span.file))
    return edited ? onChanged : undefined
  }
  if (inEntryFile) {
    const inEntry = ENTRY_REFUSALS.get(finding.code)
    return inEntry && edit.changed(blockKey) ? inEntry : undefined
  }
  const inCode = CODE_FILE_REFUSALS.get(finding.code)
  return inCode && edit.codeEdited(blockKey, span.file) ? inCode : undefined
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
      : { ...finding, code, severity: 'error', message: raisedMessage(finding.message) }
  }
  const listed: Array<D | LocatedDiagnostic> = compiled.diagnostics.map(
    (finding) => refused(finding) ?? finding
  )
  const extra = compiled.withheld.flatMap((finding) => refused(finding) ?? [])
  const budget = Math.max(
    0,
    MAX_ERRORS - listed.filter((finding) => finding.severity === 'error').length
  )
  if (extra.length <= budget) return [...listed, ...extra]
  const [first] = extra.slice(budget)
  const omitted = extra.length - budget
  const summary: LocatedDiagnostic<'E_TOO_MANY_ERRORS'> = {
    code: 'E_TOO_MANY_ERRORS',
    severity: 'error',
    message: `${omitted} more edited ${omitted === 1 ? 'finding is' : 'findings are'} refused, as the ones listed are. The next: ${first.message}`,
    hint: 'Fix the errors listed and check again to see the rest.',
    span: first.span,
    ...(first.frame === undefined ? {} : { frame: first.frame }),
    ...(first.blockKey === undefined ? {} : { blockKey: first.blockKey }),
  }
  return [...listed, ...extra.slice(0, budget), summary]
}
