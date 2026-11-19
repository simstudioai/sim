/**
 * Every structured subBlock kind whose value stays a param, one codec module per kind. The record
 * is total over those kinds, so a new kind fails to type-check until it has a codec, and each codec
 * names its hook for every stage (`codec.ts`).
 *
 * The two kinds in {@link LIFTED_STRUCTURED_KINDS} are lifted out of the param value into their own
 * model shape, which every stage handles in its own module, so they have no codec:
 * - `tools`: the `{ kind: 'tools' }` param (`canonicalize/tools.ts`, `compile/tools.ts`,
 *   `print/tools.ts`, `encodeTools` in `materialize/params.ts`);
 * - `branches`: `CanonicalBlock.branches`, never a param (`canonicalize/branches.ts`,
 *   `forms/condition.ts`, `materialize/branches.ts`).
 * A stored value of either kind that does not lift stays a plain value.
 */

import type { CatalogStructuredKind, CatalogSubBlock } from '../catalog/types'
import type { StructuredCodec } from './codec'
import { INPUT_FORMAT_CODEC } from './input-format'
import { SKILLS_CODEC } from './skills'
import { TABLE_ROWS_CODEC } from './table-rows'
import { VARIABLES_CODEC } from './variables'

const LIFTED_STRUCTURED_KINDS = [
  'tools',
  'branches',
] as const satisfies readonly CatalogStructuredKind[]

type LiftedStructuredKind = (typeof LIFTED_STRUCTURED_KINDS)[number]

const STRUCTURED_CODECS: Record<
  Exclude<CatalogStructuredKind, LiftedStructuredKind>,
  StructuredCodec
> = {
  tableRows: TABLE_ROWS_CODEC,
  inputFormat: INPUT_FORMAT_CODEC,
  variables: VARIABLES_CODEC,
  skills: SKILLS_CODEC,
}

function isLifted(kind: CatalogStructuredKind): kind is LiftedStructuredKind {
  return LIFTED_STRUCTURED_KINDS.some((lifted) => lifted === kind)
}

/**
 * The codec of a subBlock's structured kind; `undefined` for a plain subBlock, none, or a lifted
 * kind (`tools`, `branches`), whose stages do not go through a codec.
 */
export function structuredCodec(
  subBlock: Pick<CatalogSubBlock, 'structured'> | undefined
): StructuredCodec | undefined {
  const kind = subBlock?.structured
  return kind === undefined || isLifted(kind) ? undefined : STRUCTURED_CODECS[kind]
}
