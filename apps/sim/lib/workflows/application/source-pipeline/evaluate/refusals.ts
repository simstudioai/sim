import {
  type CanonicalBlock,
  type CanonicalDiff,
  type CanonicalWorkflowMeta,
  type CompileResult,
  compileWorkflow,
  type Diagnostic,
  diffCanonical,
  encodeAnchor,
  getOwn,
  type LocatedDiagnostic,
  refuseEditedFindings,
  renamesBetween,
  replacedBetween,
  type SourceSpan,
} from '@sim/workflow-code'
import { diagnostic } from '@sim/workflow-code/diagnostics'
import { isEqual } from 'es-toolkit'
import {
  V2_WORKFLOW_DESCRIPTION_MAX_LENGTH,
  V2_WORKFLOW_NAME_MAX_LENGTH,
} from '@/lib/api/contracts/v2/workflows'
import type { CompiledSubmission } from '@/lib/workflows/application/source-pipeline/evaluate/compile'
import type { ResolvedSubmission } from '@/lib/workflows/application/source-pipeline/evaluate/resolve'
import type { SourceEvaluationInput } from '@/lib/workflows/application/source-pipeline/evaluate/types'
import { workflowNameExistsInFolder } from '@/lib/workflows/orchestration'

const META_FIELDS: Array<keyof CanonicalWorkflowMeta> = ['name', 'description']

/**
 * Findings a block rename can settle: a code-file `W_UNRESOLVED_REF` (an apply rewrites every
 * `<old key.path>` to the new key, so `$ref.<old key>` runs) and a `W_JSON_REF_UNTYPED` on a JSON
 * field whose only change is that rewrite.
 */
const RENAME_SETTLED_CODES: ReadonlySet<string> = new Set([
  'W_UNRESOLVED_REF',
  'W_JSON_REF_UNTYPED',
])

/**
 * `diagnostics` without the {@link RENAME_SETTLED_CODES} findings a block rename settles. The
 * compile already knew the renames the lock names by ident; a rename materialize inferred (name
 * and const both changed) is known only now, so the source is compiled again with every rename and
 * its findings of those codes, listed and withheld, replace the first compile's. Taken whole, not
 * matched by position: the first compile withholds one finding per code, block and file, so a
 * settled one may stand for a later finding in that file that the rename leaves unresolved.
 */
function withoutRenameSettledFindings(
  compiled: Pick<CompileResult, 'diagnostics' | 'withheld'>,
  renames: ReadonlyMap<string, string>,
  recompile: () => CompileResult
): Pick<CompileResult, 'diagnostics' | 'withheld'> {
  const settles = (d: CompileResult['diagnostics'][number]) => RENAME_SETTLED_CODES.has(d.code)
  if (renames.size === 0 || ![...compiled.diagnostics, ...compiled.withheld].some(settles)) {
    return compiled
  }
  const again = recompile()
  const unsettled = (d: CompileResult['diagnostics'][number]) => !settles(d)
  return {
    diagnostics: [...compiled.diagnostics.filter(unsettled), ...again.diagnostics.filter(settles)],
    withheld: [...compiled.withheld.filter(unsettled), ...again.withheld.filter(settles)],
  }
}

/** `{ span }` when there is one, to spread into a diagnostic. */
function withSpan(span: SourceSpan | undefined): { span?: SourceSpan } {
  return span ? { span } : {}
}

/** Names in a refusal, the first ten and a count of the rest. */
function listNames(names: readonly string[]): string {
  const shown = names.slice(0, 10).join(', ')
  return names.length > 10 ? `${shown}, and ${names.length - 10} more` : shown
}

/** A variable as a delete refusal names it. */
interface NamedVariable {
  name: string
  type: string
}

/**
 * `E_APPLY_VARIABLE_DELETE` for the stored variables an apply removes, by name. When it removes
 * one and adds one of the same type, the edit may be a rename the apply could not tie to the
 * stored variable (its value changed too, or says nothing), so the hint says how to keep the id;
 * when it removes several and adds any, they may be renames made together, which the apply never
 * ties, so the hint says to make them one apply at a time.
 */
function variableDeleteRefusal(
  removed: readonly NamedVariable[],
  added: readonly NamedVariable[],
  span: SourceSpan | undefined
): Diagnostic {
  const names = removed.map((variable) => variable.name)
  const [former] = removed
  const [next] = added
  const rename =
    removed.length === 1 && added.length === 1 && former.type === next.type
      ? `If ${next.name} renames ${former.name}, keep the value ${former.name} holds and move every vars reference to the new key in this apply, then change the value in a second apply, so the variable keeps its id; a variable no block reads that holds 0, false or an empty value cannot be tied, so pass --allow-delete (allowDelete=true) to replace it.`
      : removed.length > 1 && added.length > 0
        ? `If these are renames, an apply ties only one renamed variable to its stored one: rename them one apply at a time (${listNames(names)}), so each keeps its id. Or pass --allow-delete (allowDelete=true) to delete them and create the new ones.`
        : undefined
  return diagnostic(
    'E_APPLY_VARIABLE_DELETE',
    `This apply deletes ${names.length} variable${names.length === 1 ? '' : 's'} the source no longer declares: ${listNames(names)}.`,
    {
      hint:
        rename ??
        'Pass --allow-delete (allowDelete=true) to delete them, or declare them again in workflow(name, { variables }) to keep them.',
      ...withSpan(span),
    }
  )
}

/**
 * Each removed block with the added block of the same type and parent it most probably became:
 * one pair per removed block, in order, each added block used once.
 */
function probableRenames(
  removed: readonly CanonicalBlock[],
  added: readonly CanonicalBlock[]
): Array<{ removed: CanonicalBlock; added: CanonicalBlock }> {
  const free = [...added]
  return removed.flatMap((block) => {
    const index = free.findIndex(
      (candidate) => candidate.type === block.type && candidate.parent === block.parent
    )
    if (index === -1) return []
    const [match] = free.splice(index, 1)
    return [{ removed: block, added: match }]
  })
}

/**
 * `E_APPLY_BLOCK_DELETE` for the stored blocks an apply removes. When the source adds blocks of
 * a removed block's type, they may be renames whose name and const both changed with no identity
 * signal tying them to the stored blocks (settings, connections or renamed references): the
 * finding names them and says how to keep the ids, or to pass `--allow-delete` to replace them.
 */
function blockDeleteRefusal(
  removed: readonly CanonicalBlock[],
  added: readonly CanonicalBlock[],
  span: SourceSpan | undefined
): Diagnostic {
  const removedTypes = new Set(removed.map((block) => block.type))
  const lookalikes = added.filter((block) => removedTypes.has(block.type))
  const deletes = `This apply deletes ${removed.length} block${removed.length === 1 ? '' : 's'} the source no longer declares: ${listNames(removed.map((block) => block.name))}.`
  if (lookalikes.length > 0) {
    return diagnostic(
      'E_APPLY_BLOCK_DELETE',
      `${deletes} It adds ${listNames(lookalikes.map((block) => block.name))} of the same type: if those are the same blocks renamed, both their name and const changed, so nothing ties them to the stored blocks and they would get new ids.`,
      {
        hint: 'To rename a block and keep its id, keep its const name in this apply (change it in the next), or rename the references to it with it; to replace it with a new block, pass --allow-delete.',
        ...withSpan(span),
      }
    )
  }
  return diagnostic('E_APPLY_BLOCK_DELETE', deletes, {
    hint: 'Pass --allow-delete (allowDelete=true) to delete them, or declare them again to keep them.',
    ...withSpan(span),
  })
}

/**
 * The name and description fields among `fields` that v2 create and update would refuse: an empty
 * name, or a name or description over its limit. Only the fields a write sets are checked, so a
 * stored workflow the source keeps as it is never refuses.
 */
function metaLimitRefusals(
  meta: CanonicalWorkflowMeta,
  fields: readonly (keyof CanonicalWorkflowMeta)[]
): Array<{ field: keyof CanonicalWorkflowMeta; refusal: Diagnostic }> {
  const refusals: Array<{ field: keyof CanonicalWorkflowMeta; refusal: Diagnostic }> = []
  const refuse = (field: keyof CanonicalWorkflowMeta, message: string, hint: string) =>
    refusals.push({
      field,
      refusal: diagnostic('E_WORKFLOW_META_INVALID', message, { hint }),
    })
  if (fields.includes('name') && meta.name.trim() === '') {
    refuse('name', 'The workflow name is empty.', "Name the workflow: workflow('Name', ...).")
  } else if (fields.includes('name') && meta.name.length > V2_WORKFLOW_NAME_MAX_LENGTH) {
    refuse(
      'name',
      `The workflow name is ${meta.name.length} characters, over the ${V2_WORKFLOW_NAME_MAX_LENGTH}-character limit.`,
      `Shorten the name to ${V2_WORKFLOW_NAME_MAX_LENGTH} characters or fewer.`
    )
  }
  const description = meta.description ?? ''
  if (fields.includes('description') && description.length > V2_WORKFLOW_DESCRIPTION_MAX_LENGTH) {
    refuse(
      'description',
      `The workflow description is ${description.length} characters, over the ${V2_WORKFLOW_DESCRIPTION_MAX_LENGTH}-character limit.`,
      `Shorten the description to ${V2_WORKFLOW_DESCRIPTION_MAX_LENGTH} characters or fewer.`
    )
  }
  return refusals
}

/** The source-level refusals phase's result. */
export interface SourceRefusals {
  /** The name and description after the write. */
  meta: CanonicalWorkflowMeta
  /** The name and description fields the write changes on a stored workflow. */
  metaChanged: Array<keyof CanonicalWorkflowMeta>
  /** What the write stores against what is stored, on the canonical models. */
  canonicalDiff: CanonicalDiff
  /** The compile's findings with those a block rename settles taken out. */
  compileFindings: Pick<CompileResult, 'diagnostics' | 'withheld'>
  /** Whether the source changed the code of block `key` from what is stored. */
  codeEdited: (key: string) => boolean
  /** Name, meta limit, block delete and variable delete refusals. */
  sourceRefusals: Diagnostic[]
  /** `W_APPLY_PROBABLE_RENAME` for each delete-and-add that is probably a rename. */
  renameWarnings: Diagnostic[]
}

/**
 * Diffs the materialized source against the stored graph and refuses what the source itself
 * asks for and may not do: a rename onto a name taken in the folder, a name or description over
 * its limit, and (without `allowDelete`) deleting blocks or variables. With `allowDelete`, a delete
 * and add of the same type and parent warns that it is probably a rename.
 */
export async function sourceRefusals(
  input: SourceEvaluationInput,
  submission: CompiledSubmission,
  resolved: ResolvedSubmission
): Promise<SourceRefusals> {
  const { scope } = input
  const isNew = input.create !== undefined
  const { compiled, compiledWorkflow, compileInput } = submission
  const { storedCanonical, materialized } = resolved
  let { meta } = submission

  /**
   * The name and description the source gives a stored workflow, where they differ from the
   * stored ones: the write renames or redescribes the workflow (the graph diff never sees them).
   */
  const metaChanged = isNew
    ? []
    : META_FIELDS.filter(
        (field) => (compiledWorkflow.meta[field] ?? null) !== (meta[field] ?? null)
      )
  const storedMeta = meta
  if (metaChanged.length > 0) {
    meta = {
      name: compiledWorkflow.meta.name,
      description: compiledWorkflow.meta.description ?? null,
    }
  }
  /**
   * What the write stores against what is stored: the materialized CWM, not the compiled one,
   * so a field source never prints (a forEach loop's empty while condition, a pair's stored
   * member) that materialize keeps from the stored block is no change.
   */
  const blockRenames = renamesBetween(storedCanonical.identity, materialized.identity)
  const replacedKeys = replacedBetween(storedCanonical.identity, materialized.identity)
  const canonicalDiff = diffCanonical(
    storedCanonical.workflow,
    { ...materialized.workflow, meta: storedCanonical.workflow.meta },
    blockRenames,
    replacedKeys
  )
  const renamedKeys = new Map([...blockRenames].map(([key, storedKey]) => [storedKey, key]))
  const storedKeyOf = new Map([...renamedKeys].map(([storedKey, key]) => [key, storedKey]))
  const storedCode = (key: string) => {
    const storedBlock =
      getOwn(compiled.stored.blocks, key) ??
      getOwn(compiled.stored.blocks, storedKeyOf.get(key) ?? key)
    return storedBlock && getOwn(storedBlock.params, 'code')
  }
  const compileFindings = withoutRenameSettledFindings(compiled, renamedKeys, () =>
    compileWorkflow({ ...compileInput, stored: compiled.stored, renamedKeys })
  )
  const codeEdited = (key: string) => {
    const compiledBlock = getOwn(compiledWorkflow.blocks, key)
    return !isEqual(compiledBlock && getOwn(compiledBlock.params, 'code'), storedCode(key))
  }
  const refusals: Diagnostic[] = []
  const headerSpan = compiled.spans[encodeAnchor({ kind: 'header' })]
  /** Where a finding about the workflow itself points: the field it names, else the name. */
  const metaSpan = (field: keyof CanonicalWorkflowMeta = 'name') =>
    compiled.metaSpans[field] ?? compiled.metaSpans.name ?? headerSpan
  if (
    metaChanged.includes('name') &&
    (await workflowNameExistsInFolder({
      workspaceId: scope.workspaceId,
      name: meta.name,
      folderId: scope.folderId,
      excludeWorkflowId: scope.workflowId,
    }))
  ) {
    refusals.push(
      diagnostic(
        'E_NAME_TAKEN',
        `Another workflow in this workflow's folder is named ${JSON.stringify(meta.name)}.`,
        {
          hint: `Choose another name, or keep workflow(${JSON.stringify(storedMeta.name)}, ...).`,
          ...withSpan(metaSpan('name')),
        }
      )
    )
  }
  refusals.push(
    ...metaLimitRefusals(meta, isNew ? META_FIELDS : metaChanged).map(({ field, refusal }) => ({
      ...refusal,
      ...withSpan(metaSpan(field)),
    }))
  )
  // A block replaced under its key (a retype) is reported removed and added, but it is the
  // same declaration, which W_MAT_RETYPE_RECREATED covers, so it needs no allowDelete.
  const removedKeys = isNew
    ? []
    : canonicalDiff.blocks.removed.filter((key) => !replacedKeys.has(key))
  const removedBlocks = removedKeys.map((key) => storedCanonical.workflow.blocks[key])
  const addedBlocks = canonicalDiff.blocks.added
    .filter((key) => !replacedKeys.has(key))
    .map((key) => materialized.workflow.blocks[key])
  if (removedKeys.length > 0 && !input.allowDelete) {
    refusals.push(blockDeleteRefusal(removedBlocks, addedBlocks, metaSpan()))
  }
  const keptVariableIds = new Set(Object.values(materialized.identity.variables))
  const storedVariableIds = new Set(Object.values(storedCanonical.identity.variables))
  const removedVariables = isNew
    ? []
    : Object.entries(storedCanonical.identity.variables).flatMap(([key, id]) => {
        if (keptVariableIds.has(id)) return []
        const variable = getOwn(storedCanonical.workflow.variables, key)
        return [{ name: variable?.name ?? key, type: variable?.type ?? '' }]
      })
  if (removedVariables.length > 0 && !input.allowDelete) {
    const addedVariables = Object.entries(materialized.identity.variables).flatMap(([key, id]) => {
      const variable = getOwn(materialized.workflow.variables, key)
      return storedVariableIds.has(id) || !variable
        ? []
        : [{ name: variable.name, type: variable.type }]
    })
    refusals.push(variableDeleteRefusal(removedVariables, addedVariables, metaSpan()))
  }
  const renameWarnings = input.allowDelete
    ? probableRenames(removedBlocks, addedBlocks).map(
        ({ removed, added }): Diagnostic =>
          diagnostic(
            'W_APPLY_PROBABLE_RENAME',
            `${removed.name} (${removed.type}) is deleted and ${added.name} (${added.type}) added: probably a rename, but its name and const both changed, so it gets a new id and loses its run history and webhook URL.`,
            {
              hint: `To keep the id, apply ${added.name} under the const or name ${removed.name} had first, then change the other.`,
              blockKey: added.key,
            }
          )
      )
    : []

  return {
    meta,
    metaChanged,
    canonicalDiff,
    compileFindings,
    codeEdited,
    sourceRefusals: refusals,
    renameWarnings,
  }
}

/**
 * The compile's findings, each on a block this write changes (or whose code it edits) refused as
 * the shared edited-block rule says, so a warning the author introduced cannot be written. A
 * field finding is refused only on a field the write sets (`changedFields`, by block key), the
 * fields the value gate judges.
 */
export function editedCompileFindings(
  refusals: Pick<SourceRefusals, 'compileFindings' | 'codeEdited'>,
  changedKeys: ReadonlySet<string>,
  changedFields: ReadonlyMap<string, ReadonlySet<string>>
): LocatedDiagnostic[] {
  return refuseEditedFindings(refusals.compileFindings, {
    changed: (key) => changedKeys.has(key),
    codeEdited: refusals.codeEdited,
    paramChanged: (key, param) => changedFields.get(key)?.has(param) === true,
  })
}
