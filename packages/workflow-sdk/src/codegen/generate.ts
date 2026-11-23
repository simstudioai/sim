/**
 * `generateSdkTypes(catalog, options)`: the block catalog → `.d.ts` files, for every block (the
 * CLI's cached copy of a catalog) or only the blocks a source directory holds.
 *
 * - `blocks/{type}.d.ts` per block type with builders: every builder's params and output types,
 *   and the augmentation of `@sim/workflow-sdk` with the builder functions, tool forms and
 *   `SpecialBuilderTypes` entries. One file per block keeps a write to a few hundred files; a
 *   directory's `tsconfig.json` includes only the blocks its source uses (`layout.ts`).
 * - `models.d.ts`: model ids, apart so a model-list change touches one file.
 * - `index.d.ts`: imports the models and every current block (not the legacy-only ones); the only
 *   file that names the catalog hash.
 * - `INDEX.md`: the naming rule, how a workflow runs, and one line per builder naming its block,
 *   operation, file and params type (in a directory's copy, only its blocks' builders; any other
 *   builder is one `sim workflows source params` away).
 *
 * Output is deterministic: the same catalog gives byte-identical files in path order.
 */

import { compareStrings } from '@sim/utils/string'
import type { BlockCatalog, CatalogBlock, CatalogOutput, CatalogSubBlock } from '@sim/workflow-code'
import { builderOutputSchemas, printKey, quoteString } from '@sim/workflow-code'
import { type EditorDefault, subBlockEditorDefault } from '@sim/workflow-code/catalog/defaults'
import {
  builderPins,
  hasDefaultValue,
  isWrittenInSource,
  onSurface,
  paramAliases,
  requiredForBuilder,
} from '@sim/workflow-code/catalog/surface'
import { catalogBlock, catalogBlockTypes } from '@sim/workflow-code/catalog/view'
import { hasToolForm } from '@sim/workflow-code/sdk'
import { indentLines, jsdoc, literal, pascal, union } from './emit'
import {
  blockTypesFile,
  isLegacyBuilder,
  legacyOnlyBlockTypes,
  SDK_GUIDE_FILE,
  SDK_INDEX_FILE,
  SDK_MODELS_FILE,
} from './layout'
import { mapParamType, mapSubBlock } from './map-subblock'
import { type BuilderEntry, builderEntries, TOOL_NAMESPACE } from './names'
import { builderOutputs, type DynamicOutputPlan, dynamicOutputPlan, renderMembers } from './outputs'
import { RUNTIME_SEMANTICS } from './semantics'
import {
  buildVisibilityContext,
  classifyParam,
  findGate,
  type Gate,
  type ParamVisibility,
  type Scalar,
  type VisibilityContext,
} from './visibility'

export interface SdkTypeFile {
  path: string
  text: string
}

/** Which declarations `generateSdkTypes` writes. */
interface SdkTypesOptions {
  /**
   * Only these block types' files, with `index.d.ts` importing them and `INDEX.md` listing their
   * builders: a source directory's own copy. Without it, every block (the cached full catalog).
   */
  blockTypes?: ReadonlySet<string>
}

export type GenerateSdkTypesFn = (catalog: BlockCatalog, options?: SdkTypesOptions) => SdkTypeFile[]

/** Names `core.d.ts` exports that generated files may reference; imported only when used. */
const CORE_TYPE_NAMES = [
  'AnyRef',
  'Block',
  'BlockMeta',
  'BranchExpression',
  'CredentialIdValue',
  'CredentialKeyFor',
  'CredentialRef',
  'DocumentTag',
  'EvalMetric',
  'FileRef',
  'Filter',
  'FolderRef',
  'InputFields',
  'InputFieldsOutput',
  'InputMapping',
  'Json',
  'JsonWithRefs',
  'KnowledgeBaseRef',
  'LiteralUnion',
  'McpServerRef',
  'Message',
  'Model',
  'ModelFallback',
  'RefTo',
  'ResponseFields',
  'ResponseFormat',
  'ResponseFormatOutput',
  'SimFile',
  'SkillRef',
  'Sort',
  'TableData',
  'TableDataPatch',
  'TablePredicate',
  'TableRef',
  'TableRow',
  'TagFilter',
  'Template',
  'TimeString',
  'Tool',
  'ToolOpts',
  'UploadedFile',
  'Value',
  'VariableAssignment',
  'WorkflowRef',
] as const

const HEADER_PREFIX = '// @sim-sdk'

function header(sdkMajor: number): string {
  return `${HEADER_PREFIX} ${sdkMajor} · generated from the block catalog; do not edit`
}

/**
 * The first line of `index.d.ts`, which names the catalog hash. The rest of the index follows from
 * the catalog, so an index with this line was generated from this catalog.
 */
export function sdkIndexHeader(catalog: Pick<BlockCatalog, 'sdkMajor' | 'hash'>): string {
  return `${HEADER_PREFIX} ${catalog.sdkMajor} · generated from block catalog ${catalog.hash}; do not edit`
}

/** The subBlocks a builder can write: the ones its surface uses (`onSurface`) that source can state. */
function candidateSubBlocks(block: CatalogBlock, entry: BuilderEntry): CatalogSubBlock[] {
  const triggerMode = entry.builder.triggerMode === true
  const pins = builderPins(entry.builder)
  return block.subBlocks.filter((subBlock) => {
    if (!isWrittenInSource(subBlock) || !onSurface(block, subBlock, triggerMode)) return false
    if (pins.has(subBlock.id)) return false
    return mapSubBlock(subBlock) !== null
  })
}

interface Param {
  /** The subBlock id or canonical id. */
  name: string
  /** What source writes: the catalog's alias for the param (`paramAliases`), else `name`. */
  key: string
  members: CatalogSubBlock[]
  visibility: ParamVisibility
  type: string
  doc: string[]
}

function paramDoc(members: readonly CatalogSubBlock[], visibility: ParamVisibility): string[] {
  const lines: string[] = []
  const title = members.find((member) => member.title)?.title
  if (title) lines.push(title)
  for (const member of members) {
    const mapped = mapSubBlock(member)
    if (mapped) for (const line of mapped.doc) if (!lines.includes(line)) lines.push(line)
  }
  const basic = members.find((member) => member.mode === 'basic')
  const advanced = members.find((member) => member.mode === 'advanced')
  if (basic && advanced) lines.push(`Basic \`${basic.id}\` or advanced \`${advanced.id}\`.`)
  const dependsOn = new Set<string>()
  for (const member of members) {
    for (const field of member.dependsOn?.all ?? []) dependsOn.add(field)
    for (const field of member.dependsOn?.any ?? []) dependsOn.add(field)
  }
  if (dependsOn.size > 0) lines.push(`@dependsOn ${[...dependsOn].join(', ')}`)
  if (visibility.when) lines.push(`@when ${visibility.when}`)
  return lines
}

function groupParams(candidates: readonly CatalogSubBlock[]): Map<string, CatalogSubBlock[]> {
  const groups = new Map<string, CatalogSubBlock[]>()
  for (const subBlock of candidates) {
    const name = subBlock.canonicalParamId ?? subBlock.id
    const group = groups.get(name)
    if (group) group.push(subBlock)
    else groups.set(name, [subBlock])
  }
  return groups
}

interface BuilderOutput {
  name: string
  /** Type parameter list for a generic output (`<T extends string = string>`), else `''`. */
  typeParameters: string
  /** Type arguments that forward the parameters (`<T>`), else `''`. */
  typeArguments: string
  /** The interface body (members), shared between builders whose bodies match. */
  body: string
}

/** One param of a builder, as `describeBuilder` reports it. */
export interface ParamFact {
  /** What source writes. */
  key: string
  /** The TypeScript type, `| null` included where a stored empty value prints as `null`. */
  type: string
  required: boolean
  /** The param's doc lines: title, bounds, selector, dependencies. */
  doc: string[]
  /** The value an omitted param means (the editor default), when it has one. */
  default?: EditorDefault
}

/**
 * The params of a builder as facts: the ones every call takes, and when one field (the gate)
 * decides which others apply, its values and the params of each.
 */
export interface ParamFacts {
  common: ParamFact[]
  gate: {
    key: string
    /** The gate's value when it is omitted, if any. */
    default?: Scalar
    variants: Array<{ values: Scalar[]; params: ParamFact[] }>
  } | null
}

export interface BuilderTypes {
  /** The params type declaration, exported. */
  params: string
  output: BuilderOutput
  /** The function signature line(s) inside the namespace. */
  signature: string[]
  /** The tool-form signature, or `null`. */
  tool: string[] | null
  /** The `SpecialBuilderTypes` member, for core-declared builders. */
  special: string | null
  /** `Block: Operation`, the builder's one-line description. */
  summary: string
  /** The params type's name. */
  paramsName: string
  /** The params as facts. */
  facts: ParamFacts
}

/**
 * The outputs of an operation builder whose tool the catalog records (`operationOutputs`): only
 * those the tool returns, and which of them may be `null`.
 */
function operationOutputs(
  block: CatalogBlock,
  entry: BuilderEntry,
  outputs: Record<string, CatalogOutput>
): { outputs: Record<string, CatalogOutput>; nullable: ReadonlySet<string> } {
  const operation = entry.builder.operation
  const byOperation = block.operationOutputs
  const returned =
    operation !== undefined &&
    !entry.builder.triggerMode &&
    outputs === block.outputs &&
    byOperation &&
    Object.hasOwn(byOperation, operation)
      ? byOperation[operation]
      : undefined
  if (!returned) return { outputs, nullable: new Set() }
  const picked: Record<string, CatalogOutput> = {}
  for (const name of returned.names) if (Object.hasOwn(outputs, name)) picked[name] = outputs[name]
  return { outputs: picked, nullable: new Set(returned.nullable ?? []) }
}

/** The label of `operation` in the block's operation dropdown, if it has one. */
export function operationLabel(block: CatalogBlock, operation: string): string | undefined {
  const dropdown = block.subBlocks.find((subBlock) => subBlock.id === 'operation')
  if (!dropdown || !Array.isArray(dropdown.options)) return undefined
  return dropdown.options.find((option) => option.id === operation)?.label
}

function defaultGateValue(
  candidates: readonly CatalogSubBlock[],
  field: string
): Scalar | undefined {
  const subBlock = candidates.find((candidate) => candidate.id === field)
  if (!subBlock) return undefined
  const { defaultValue } = subBlock
  if (
    typeof defaultValue === 'string' ||
    typeof defaultValue === 'number' ||
    typeof defaultValue === 'boolean'
  ) {
    return defaultValue
  }
  return Array.isArray(subBlock.options) ? subBlock.options[0]?.id : undefined
}

/**
 * A param whose field canvas creation seeds with an editor default also takes `null`: source
 * omits a value equal to the default, and writes `null` for a field stored with no value.
 */
function renderProperty(param: Param, required: boolean, indent: string): string[] {
  const nullable = param.members.some((member) => subBlockEditorDefault(member) !== undefined)
  return [
    ...jsdoc(param.doc, indent),
    `${indent}${printKey(param.key)}${required ? '' : '?'}: ${param.type}${nullable ? ' | null' : ''}`,
  ]
}

/** A gated variant's param is required where it is required for every value the variant covers. */
function requiredInVariant(param: Param, requiredByVisibility: boolean): boolean {
  return requiredByVisibility && !hasDefaultValue(param.members)
}

/** The params of a builder as {@link ParamFacts}, required as the params type renders them. */
function paramFacts(
  params: readonly Param[],
  gate: Gate | null,
  candidates: readonly CatalogSubBlock[],
  pinned: VisibilityContext['pinned']
): ParamFacts {
  const fact = (param: Param, required: boolean): ParamFact => {
    const editorDefault = param.members
      .map((member) => subBlockEditorDefault(member))
      .find((value) => value !== undefined)
    const nullable = param.members.some((member) => subBlockEditorDefault(member) !== undefined)
    return {
      key: param.key,
      type: nullable ? `${param.type} | null` : param.type,
      required,
      doc: param.doc.filter((line) => !line.startsWith('@when')),
      ...(editorDefault !== undefined ? { default: editorDefault } : {}),
    }
  }
  const gated = new Set<string>()
  if (gate) {
    gated.add(gate.field)
    for (const variant of gate.variants) for (const p of variant.params) gated.add(p.name)
  }
  const common = params
    .filter((param) => !gated.has(param.name))
    .map((param) => fact(param, requiredForBuilder(param.members, pinned)))
  if (!gate) return { common, gate: null }
  const fallback = defaultGateValue(candidates, gate.field)
  return {
    common,
    gate: {
      key: params.find((param) => param.name === gate.field)?.key ?? gate.field,
      ...(fallback !== undefined ? { default: fallback } : {}),
      variants: gate.variants.map((variant) => ({
        values: [...variant.values],
        params: variant.params.flatMap(({ name, required }) => {
          const param = params.find((candidate) => candidate.name === name)
          return param ? [fact(param, requiredInVariant(param, required))] : []
        }),
      })),
    },
  }
}

function renderParamsType(
  params: readonly Param[],
  gate: Gate | null,
  candidates: readonly CatalogSubBlock[],
  pinned: VisibilityContext['pinned']
): string {
  const gated = new Set<string>()
  if (gate) {
    gated.add(gate.field)
    for (const variant of gate.variants) for (const p of variant.params) gated.add(p.name)
  }
  const common = params.filter((param) => !gated.has(param.name))
  const commonLines = common.flatMap((param) =>
    renderProperty(param, requiredForBuilder(param.members, pinned), '  ')
  )
  const commonType = commonLines.length > 0 ? `{\n${commonLines.join('\n')}\n}` : '{}'
  if (!gate) return commonType
  const gateParam = params.find((param) => param.name === gate.field)
  const fallback = defaultGateValue(candidates, gate.field)
  const nullable =
    gateParam?.members.some((member) => subBlockEditorDefault(member) !== undefined) === true
  const variants = gate.variants.map((variant) => {
    const optional = fallback !== undefined && variant.values.includes(fallback)
    // `null` (stored with no value) runs as the default, so it belongs to the default's variant.
    const values = union(variant.values.map(literal))
    const lines: string[] = [
      ...jsdoc(gateParam?.doc ?? [], '    '),
      `    ${printKey(gate.field)}${optional ? '?' : ''}: ${values}${optional && nullable ? ' | null' : ''}`,
    ]
    for (const { name, required } of variant.params) {
      const param = params.find((candidate) => candidate.name === name)
      if (!param) continue
      const doc = param.doc.filter((line) => !line.startsWith('@when'))
      lines.push(...renderProperty({ ...param, doc }, requiredInVariant(param, required), '    '))
    }
    return `  | {\n${lines.join('\n')}\n    }`
  })
  const variantType = `(\n${variants.join('\n')}\n)`
  return commonLines.length > 0 ? `${commonType} & ${variantType}` : variantType
}

function typeParameterList(plan: DynamicOutputPlan | null, withConst: boolean): string {
  if (!plan) return ''
  const { name, constraint, fallback, isConst } = plan.typeParameter
  return `<${withConst && isConst ? 'const ' : ''}${name} extends ${constraint} = ${fallback}>`
}

/**
 * A filter builder paired with a JSON editor (`table_v2`'s `filterInput`): the runtime reads an
 * array as builder rules and anything else as a predicate (`resolveFilter`), so the param takes
 * those two shapes or JSON text, never the JSON member's loose `JsonWithRefs`.
 */
function isTableFilterPair(members: readonly CatalogSubBlock[]): boolean {
  return (
    members.some((member) => member.type === 'filter-builder') &&
    members.every(
      (member) =>
        member.type === 'filter-builder' || (member.type === 'code' && member.language === 'json')
    )
  )
}

function buildParams(
  block: CatalogBlock,
  entry: BuilderEntry,
  plan: DynamicOutputPlan | null
): {
  params: Param[]
  gate: Gate | null
  candidates: CatalogSubBlock[]
  context: VisibilityContext
} {
  const candidates = candidateSubBlocks(block, entry)
  const context = buildVisibilityContext(candidates, Object.fromEntries(builderPins(entry.builder)))
  const coreParams = new Set(entry.special?.coreParams ?? [])
  const aliases = paramAliases(block, entry.builder.triggerMode === true)
  const params: Param[] = []
  for (const [name, members] of groupParams(candidates)) {
    if (coreParams.has(name)) continue
    const visibility = classifyParam(members, context)
    if (visibility.kind === 'never') continue
    let type = mapParamType(members)
    if (isTableFilterPair(members)) type = 'Filter | TablePredicate | Template | string'
    if (plan && plan.param.name === name) type = plan.param.type
    else if (plan?.paramOverrides[name]) type = plan.paramOverrides[name]
    params.push({
      name,
      key: aliases.get(name) ?? name,
      members,
      visibility,
      type,
      doc: paramDoc(members, visibility),
    })
  }
  const alwaysVisible = new Set(
    params.filter((param) => param.visibility.kind === 'always').map((param) => param.name)
  )
  const gate = findGate(params, context, alwaysVisible)
  return { params, gate, candidates, context }
}

/** A builder's generated types: its params and output declarations, signatures and facts. */
export function builderTypes(catalog: BlockCatalog, entry: BuilderEntry): BuilderTypes {
  const block = catalogBlock(catalog, entry.builder.type)
  if (!block) {
    throw new Error(
      `sdk codegen: builder \`${entry.key}\` names unknown block type \`${entry.builder.type}\``
    )
  }
  const { outputs, nullable } = operationOutputs(
    block,
    entry,
    builderOutputSchemas(catalog, block, entry.builder)
  )
  const spec = block.dynamicOutputs ?? null
  const plan =
    spec && !entry.special ? dynamicOutputPlan(spec, outputs, entry.builder.operation) : null
  const { params, gate, candidates, context } = buildParams(block, entry, plan)
  const paramsName = `${entry.typeName}Params`
  const outputName = `${entry.typeName}Output`
  const generic = typeParameterList(plan, false)
  const genericArgs = plan ? `<${plan.typeParameter.name}>` : ''
  const outputGeneric = plan && Object.keys(plan.outputOverrides).length > 0
  const members = builderOutputs(outputs, context, plan?.outputOverrides ?? {}, nullable)
  const paramsDeclaration = `export type ${paramsName}${generic} = ${renderParamsType(params, gate, candidates, context.pinned)}`
  const output: BuilderOutput = {
    name: outputName,
    typeParameters: outputGeneric ? generic : '',
    typeArguments: outputGeneric ? genericArgs : '',
    body: renderMembers(members, '  ').join('\n'),
  }
  const outputRef = `${outputName}${outputGeneric ? genericArgs : ''}`
  // A declared output replaces a fixed one of the same name, as the runtime assigns it over.
  const outputType = plan?.outputExtension
    ? `Omit<${outputRef}, keyof ${plan.outputExtension}> & ${plan.outputExtension}`
    : outputRef
  const method = entry.path[entry.path.length - 1]
  const label = entry.builder.operation ? operationLabel(block, entry.builder.operation) : undefined
  const jsdocSummary = [
    `${block.name}${label ? `: ${label}` : ''}`,
    entry.builder.operation ? `(operation \`${entry.builder.operation}\`)` : '',
    entry.builder.triggerMode ? '(trigger mode)' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const signature = entry.special
    ? []
    : [
        ...jsdoc([jsdocSummary], ''),
        `export function ${method}${typeParameterList(plan, true)}(name: string, params: ${paramsName}${genericArgs}, meta?: BlockMeta): Block<${outputType}>`,
      ]
  const tool =
    !entry.special && hasToolForm(entry.key, entry.builder, block)
      ? [
          ...jsdoc([`${jsdocSummary}, as an agent tool`], ''),
          `export function ${method}(params?: Partial<${paramsName}>, options?: ToolOpts): Tool`,
        ]
      : null
  const special = entry.special
    ? `${entry.key}: { params: ${paramsName}; output: ${outputName} }`
    : null
  return {
    params: paramsDeclaration,
    output,
    signature,
    tool,
    special,
    summary: [block.name, label].filter(Boolean).join(': '),
    paramsName,
    facts: paramFacts(params, gate, candidates, context.pinned),
  }
}

function stripComments(text: string): string {
  return text.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

function coreImports(text: string): string {
  const code = stripComments(text)
  const used = CORE_TYPE_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(code))
  return used.length > 0 ? `import type { ${used.join(', ')} } from '@sim/workflow-sdk'\n` : ''
}

interface NamespaceNode {
  /** The namespace's doc comment: the block and the builders it declares here. */
  doc: string[]
  functions: string[][]
  /** The names of the builders declared here, for the doc comment. */
  methods: string[]
  tools: string[][]
  children: Map<string, NamespaceNode>
}

function emptyNode(): NamespaceNode {
  return { doc: [], functions: [], methods: [], tools: [], children: new Map() }
}

/** Namespaces many block files augment, which no one block's doc comment describes. */
const SHARED_NAMESPACES: ReadonlySet<string> = new Set(['trigger', 'legacy'])

function renderNamespace(node: NamespaceNode): string[] {
  const lines: string[] = []
  for (const fn of node.functions) lines.push(...fn)
  if (node.tools.length > 0) {
    lines.push(`export namespace ${TOOL_NAMESPACE} {`)
    for (const fn of node.tools) lines.push(...indentLines(fn, '  '))
    lines.push('}')
  }
  const names = [...node.children.keys()].sort(compareStrings)
  for (const name of names) {
    const child = node.children.get(name)
    if (!child) continue
    lines.push(...jsdoc(child.doc, ''), `export namespace ${name} {`)
    lines.push(...indentLines(renderNamespace(child), '  '))
    lines.push('}')
  }
  return lines
}

function outputSignature(output: BuilderOutput): string {
  return `${output.typeParameters}\u0000${output.body}`
}

function interfaceDeclaration(name: string, output: BuilderOutput): string {
  return output.body
    ? `export interface ${name}${output.typeParameters} {\n${output.body}\n}`
    : `export interface ${name}${output.typeParameters} {}`
}

/**
 * Output bodies two or more builders of one block share, declared once in the block file
 * (`SlackV2Output`, `SlackV2Output2`, ...) so each builder's output aliases one instead of
 * repeating a block-wide output list.
 */
function sharedOutputs(
  type: string,
  outputs: readonly BuilderOutput[]
): Map<string, { name: string; output: BuilderOutput }> {
  const counts = new Map<string, number>()
  for (const output of outputs) {
    const signature = outputSignature(output)
    counts.set(signature, (counts.get(signature) ?? 0) + 1)
  }
  const shared = new Map<string, { name: string; output: BuilderOutput }>()
  const base = `${pascal([type])}Output`
  for (const output of outputs) {
    const signature = outputSignature(output)
    if ((counts.get(signature) ?? 0) < 2 || shared.has(signature)) continue
    const name = shared.size === 0 ? base : `${base}${shared.size + 1}`
    shared.set(signature, { name, output })
  }
  return shared
}

/**
 * Gives each namespace that declares builders of this block (`slack`, `legacy.gmail`,
 * `trigger.gmail`, not the shared `trigger` or `legacy`) a doc comment listing them, so an editor
 * hover or a `grep` of the namespace shows every operation.
 */
function documentNamespaces(node: NamespaceNode, blockName: string, type: string): void {
  for (const [name, child] of node.children) {
    if (child.methods.length > 0 && !SHARED_NAMESPACES.has(name)) {
      child.doc = [`${blockName} (\`${type}\`) builders:`, ...child.methods]
    }
    documentNamespaces(child, blockName, type)
  }
}

/** One `INDEX.md` line's facts about a builder. */
interface IndexEntry {
  key: string
  type: string
  summary: string
  paramsName: string
}

function generateBlockFile(
  catalog: BlockCatalog,
  type: string,
  entries: readonly BuilderEntry[],
  index: IndexEntry[]
): SdkTypeFile {
  const root = emptyNode()
  const inlineDeclarations: string[] = []
  const specials: string[] = []
  const built = entries.map((entry) => ({ entry, types: builderTypes(catalog, entry) }))
  const shared = sharedOutputs(
    type,
    built.map(({ types }) => types.output)
  )
  const sharedDeclarations = [...shared.values()].map(
    ({ name, output }) => `${interfaceDeclaration(name, output)}\n`
  )
  for (const { entry, types } of built) {
    const sharedOutput = shared.get(outputSignature(types.output))
    const outputDeclaration = sharedOutput
      ? `export type ${types.output.name}${types.output.typeParameters} = ${sharedOutput.name}${types.output.typeArguments}`
      : interfaceDeclaration(types.output.name, types.output)
    inlineDeclarations.push(types.params, '', outputDeclaration, '')
    let node = root
    for (const segment of entry.path.slice(0, -1)) {
      let child = node.children.get(segment)
      if (!child) {
        child = emptyNode()
        node.children.set(segment, child)
      }
      node = child
    }
    if (types.signature.length > 0) {
      node.functions.push(types.signature)
      node.methods.push(`\`${entry.path[entry.path.length - 1]}\`: ${types.summary}`)
    }
    if (types.tool) node.tools.push(types.tool)
    if (types.special) specials.push(types.special)
    index.push({ key: entry.key, type, summary: types.summary, paramsName: types.paramsName })
  }
  documentNamespaces(root, catalogBlock(catalog, type)?.name ?? type, type)
  const moduleBody = renderNamespace(root)
  if (specials.length > 0) {
    moduleBody.push('interface SpecialBuilderTypes {', ...specials.map((s) => `  ${s}`), '}')
  }
  const declarations = [...sharedDeclarations, ...inlineDeclarations].join('\n')
  const augmentation = [
    `declare module '@sim/workflow-sdk' {`,
    ...indentLines(moduleBody, '  '),
    '}',
  ].join('\n')
  const imports = coreImports(`${declarations}\n${augmentation}`).trimEnd()
  return {
    path: blockTypesFile(type),
    text: [
      header(catalog.sdkMajor),
      imports,
      '',
      declarations.trimEnd(),
      declarations.trim() ? '' : null,
      augmentation,
      '',
    ]
      .filter((part): part is string => part !== null)
      .join('\n'),
  }
}

function modelIds(catalog: BlockCatalog): string[] {
  const ids = new Set<string>()
  for (const type of catalogBlockTypes(catalog)) {
    for (const subBlock of catalogBlock(catalog, type)?.subBlocks ?? []) {
      if (subBlock.id !== 'model' || subBlock.type !== 'combobox') continue
      if (!Array.isArray(subBlock.options)) continue
      for (const option of subBlock.options) ids.add(option.id)
    }
  }
  return [...ids].sort(compareStrings)
}

function generateModelsFile(catalog: BlockCatalog): SdkTypeFile {
  const members = modelIds(catalog).map((id) => `    ${quoteString(id)}: true`)
  const body =
    members.length > 0 ? ['  interface ModelIds {', ...members, '  }'] : ['  interface ModelIds {}']
  return {
    path: SDK_MODELS_FILE,
    text: [
      header(catalog.sdkMajor),
      'export {}',
      '',
      `declare module '@sim/workflow-sdk' {`,
      ...body,
      '}',
      '',
    ].join('\n'),
  }
}

/** The block-type → builder naming rule, shown at the top of `INDEX.md`. */
const NAMING_RULE = [
  'A builder is named for its service, not its block type: the current version of a block owns the',
  'plain namespace (`gmail_v2` → `gmail.*`, `slack_v2` → `slack.*`) and older hidden versions sit',
  'under `legacy.*` (`legacy.gmail.sendEmail`). Triggers are `trigger.*` (`trigger.gmail.poller`).',
  'Core blocks have builders of their own in `core.d.ts`: `workflow_input` is `runWorkflow`,',
  '`function` is `fn`, `router_v2` is `router`, `human_in_the_loop_v2` is `human`, `variables` is',
  '`setVariables`; `loop.*` and `parallel.*` are containers. An operation as an agent tool is',
  '`<namespace>.tool.<operation>(params)` (`slack.tool.sendMessage({ … })`).',
]

/** The lookup command for any builder, which the directory's `INDEX.md` points to. */
const PARAMS_LOOKUP =
  'Look up any builder, used here or not: `sim workflows source params <builder>` (`table.upsertRow`, `trigger.schedule`; a namespace such as `gmail` lists its builders) prints its params and outputs offline.'

/**
 * `INDEX.md`: one line per builder, `key — Block: Operation → file (ParamsType)`, current builders
 * first and legacy ones in their own section. The full catalog's lists every builder; a
 * directory's (`subset`) only the builders of the blocks it holds, beside the lookup command.
 */
function generateSdkIndex(
  catalog: BlockCatalog,
  entries: readonly IndexEntry[],
  subset: boolean
): SdkTypeFile {
  const line = (entry: IndexEntry) =>
    `- \`${entry.key}\` — ${entry.summary} → \`${blockTypesFile(entry.type)}\` (\`${entry.paramsName}\`)`
  const sorted = [...entries].sort((a, b) => compareStrings(a.key, b.key))
  const current = sorted.filter((entry) => !isLegacyBuilder(entry.key))
  const legacy = sorted.filter((entry) => isLegacyBuilder(entry.key))
  return {
    path: SDK_GUIDE_FILE,
    text: [
      '# Workflow SDK builders',
      '',
      `Generated from block catalog ${catalog.hash} (SDK ${catalog.sdkMajor}); do not edit.`,
      '',
      ...NAMING_RULE,
      '',
      PARAMS_LOOKUP,
      '',
      ...RUNTIME_SEMANTICS,
      subset ? '## Builders of the blocks in this directory' : '## Builders',
      '',
      ...current.map(line),
      '',
      ...(legacy.length > 0
        ? [
            '## Legacy builders',
            '',
            'Older block versions, kept so stored workflows still print. Write the current builder instead.',
            '',
            ...legacy.map(line),
            '',
          ]
        : []),
    ].join('\n'),
  }
}

/**
 * Generates the declaration files and `INDEX.md` for a catalog, sorted by path: every block, or
 * only `options.blockTypes` (a directory's own copy, whose `index.d.ts` imports just those).
 */
export const generateSdkTypes: GenerateSdkTypesFn = (catalog, options = {}) => {
  const byType = new Map<string, BuilderEntry[]>()
  for (const entry of builderEntries(catalog)) {
    if (options.blockTypes && !options.blockTypes.has(entry.builder.type)) continue
    const list = byType.get(entry.builder.type)
    if (list) list.push(entry)
    else byType.set(entry.builder.type, [entry])
  }
  const types = [...byType.keys()].sort(compareStrings)
  // A directory's index imports every block it holds: it holds a legacy-only one only when used.
  const legacyOnly = options.blockTypes ? new Set<string>() : legacyOnlyBlockTypes(catalog)
  const index: IndexEntry[] = []
  const files: SdkTypeFile[] = [generateModelsFile(catalog)]
  for (const type of types) {
    files.push(generateBlockFile(catalog, type, byType.get(type) ?? [], index))
  }
  files.push(generateSdkIndex(catalog, index, options.blockTypes !== undefined))
  files.push({
    path: SDK_INDEX_FILE,
    text: [
      sdkIndexHeader(catalog),
      `import './${SDK_MODELS_FILE.replace(/\.d\.ts$/, '')}'`,
      ...types
        .filter((type) => !legacyOnly.has(type))
        .map((type) => `import './${blockTypesFile(type).replace(/\.d\.ts$/, '')}'`),
      '',
      'export {}',
      '',
    ].join('\n'),
  })
  return files.sort((a, b) => compareStrings(a.path, b.path))
}
