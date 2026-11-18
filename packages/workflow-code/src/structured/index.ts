/**
 * Every structured subBlock kind's codec, one module per kind. The record is total over
 * `CatalogStructuredKind`, so a new kind fails to type-check until it has a codec, and each codec
 * names its hook for every stage (`codec.ts`).
 */

import type { CatalogStructuredKind, CatalogSubBlock } from '../catalog/types'
import { BRANCHES_CODEC } from './branches'
import type { StructuredCodec } from './codec'
import { INPUT_FORMAT_CODEC } from './input-format'
import { SKILLS_CODEC } from './skills'
import { TABLE_ROWS_CODEC } from './table-rows'
import { TOOLS_CODEC } from './tools'
import { VARIABLES_CODEC } from './variables'

const STRUCTURED_CODECS: Record<CatalogStructuredKind, StructuredCodec> = {
  tools: TOOLS_CODEC,
  branches: BRANCHES_CODEC,
  tableRows: TABLE_ROWS_CODEC,
  inputFormat: INPUT_FORMAT_CODEC,
  variables: VARIABLES_CODEC,
  skills: SKILLS_CODEC,
}

/** The codec of a subBlock's structured kind; `undefined` for a plain subBlock or none. */
export function structuredCodec(
  subBlock: Pick<CatalogSubBlock, 'structured'> | undefined
): StructuredCodec | undefined {
  return subBlock?.structured === undefined ? undefined : STRUCTURED_CODECS[subBlock.structured]
}
