/**
 * `generateSdkTypes(catalog)`: the block catalog → `.d.ts` files.
 *
 * - `blocks/{type}.d.ts` per block type with builders. It augments `@sim/workflow-sdk` with the
 *   builder functions, tool forms and `SpecialBuilderTypes` entries.
 * - `operations/{type}/{operation}.d.ts` per operation builder, holding that operation's params
 *   and output types, so an agent can read one operation (about 1–2 KB) on demand.
 * - `models.d.ts`: model ids, apart so a model-list change touches one file.
 * - `index.d.ts`: imports everything; the only file that names the catalog hash.
 *
 * Output is deterministic: the same catalog gives byte-identical files in path order.
 */

import { compareStrings } from '@sim/utils/string'
import type { BlockCatalog, CatalogBlock, CatalogOutput, CatalogSubBlock } from '@sim/workflow-code'
import { subBlockEditorDefault } from '@sim/workflow-code/catalog/defaults'
import { onSurface, paramAliases } from '@sim/workflow-code/catalog/surface'
import { catalogBlock, catalogBlockTypes, catalogTrigger } from '@sim/workflow-code/catalog/view'
import { indentLines, jsdoc, literal, pascal, propertyKey, quote, union } from './emit'
import { mapSubBlock } from './map-subblock'
import { type BuilderEntry, builderEntries, TOOL_NAMESPACE } from './names'
import { builderOutputs, type DynamicOutputPlan, dynamicOutputPlan, renderMembers } from './outputs'
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

export type GenerateSdkTypesFn = (catalog: BlockCatalog) => SdkTypeFile[]

/** Names `core.d.ts` exports that generated files may reference; imported only when used. */
const CORE_TYPE_NAMES = [
  'AnyRef',
  'Block',
  'BlockMeta',
  'BranchExpression',
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
  'Message',
  'Model',
  'ModelFallback',
  'ResponseFields',
  'ResponseFormat',
  'ResponseFormatOutput',
  'SimFile',
  'SkillRef',
  'Sort',
  'TableData',
  'TableRef',
  'TableRow',
  'TagFilter',
  'Template',
  'TimeString',
  'Tool',
  'ToolOpts',
  'Value',
  'VariableAssignment',
  'WorkflowRef',
] as const

/**
 * Trigger subBlocks the SDK never writes (`SYSTEM_SUBBLOCK_IDS` in apps/sim/triggers/constants.ts,
 * minus the credential, plus the server-owned `triggerPath`).
 */
const SYSTEM_SUBBLOCK_IDS: ReadonlySet<string> = new Set([
  'triggerInstructions',
  'webhookUrlDisplay',
  'samplePayload',
  'setupScript',
  'scheduleInfo',
  'triggerPath',
  'selectedTriggerId',
  'operation',
])

/** Types whose control always holds a value (first option, off, minimum), so never required. */
const ALWAYS_VALUED_TYPES: ReadonlySet<string> = new Set(['dropdown', 'switch', 'slider'])

const HEADER_PREFIX = '// @sim-sdk'

function header(sdkMajor: number): string {
  return `${HEADER_PREFIX} ${sdkMajor} · generated from the block catalog; do not edit`
}

/** The subBlocks a builder can write: the ones its surface uses (`onSurface`) that source can state. */
function candidateSubBlocks(block: CatalogBlock, entry: BuilderEntry): CatalogSubBlock[] {
  const triggerMode = entry.builder.triggerMode === true
  const fixed = entry.builder.fixed ?? {}
  return block.subBlocks.filter((subBlock) => {
    if (subBlock.hidden || subBlock.context === 'tool-input') return false
    if (!onSurface(block, subBlock, triggerMode)) return false
    if (SYSTEM_SUBBLOCK_IDS.has(subBlock.id) || subBlock.id.startsWith('samplePayload')) {
      return false
    }
    if (subBlock.id in fixed) return false
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

function hasDefault(members: readonly CatalogSubBlock[]): boolean {
  return members.some(
    (member) =>
      member.defaultValue !== undefined ||
      (member.valueDefault !== undefined && 'constant' in member.valueDefault) ||
      subBlockEditorDefault(member) !== undefined ||
      ALWAYS_VALUED_TYPES.has(member.type)
  )
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

interface BuilderTypes {
  /** The params type declaration, exported. */
  params: string
  output: BuilderOutput
  /** The function signature line(s) inside the namespace. */
  signature: string[]
  /** The tool-form signature, or `null`. */
  tool: string[] | null
  /** The `SpecialBuilderTypes` member, for core-declared builders. */
  special: string | null
  /** Exported names, for the block file's import. */
  exportedTypes: string[]
}

function pinnedValues(entry: BuilderEntry): Record<string, Scalar> {
  const pinned: Record<string, Scalar> = { ...(entry.builder.fixed ?? {}) }
  if (entry.builder.operation !== undefined) pinned.operation = entry.builder.operation
  return pinned
}

function outputSource(
  catalog: BlockCatalog,
  block: CatalogBlock,
  entry: BuilderEntry
): Record<string, CatalogOutput> {
  const triggerId = entry.builder.fixed?.selectedTriggerId
  const pinned = triggerId ? catalogTrigger(catalog, triggerId) : undefined
  if (pinned) return pinned.outputs
  const isTrigger = entry.builder.triggerMode === true || block.category === 'triggers'
  const available = block.triggers?.available ?? []
  const only =
    isTrigger && available.length === 1 ? catalogTrigger(catalog, available[0]) : undefined
  return only ? only.outputs : block.outputs
}

function operationLabel(block: CatalogBlock, operation: string): string | undefined {
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
  if (typeof defaultValue === 'string' || typeof defaultValue === 'number') return defaultValue
  if (typeof defaultValue === 'boolean') return defaultValue
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
    `${indent}${propertyKey(param.key)}${required ? '' : '?'}: ${param.type}${nullable ? ' | null' : ''}`,
  ]
}

function isRequired(param: Param, requiredByVisibility: boolean): boolean {
  return requiredByVisibility && !hasDefault(param.members)
}

function renderParamsType(
  params: readonly Param[],
  gate: Gate | null,
  candidates: readonly CatalogSubBlock[]
): string {
  const gated = new Set<string>()
  if (gate) {
    gated.add(gate.field)
    for (const variant of gate.variants) for (const p of variant.params) gated.add(p.name)
  }
  const common = params.filter((param) => !gated.has(param.name))
  const commonLines = common.flatMap((param) =>
    renderProperty(param, isRequired(param, param.visibility.required), '  ')
  )
  const commonType = commonLines.length > 0 ? `{\n${commonLines.join('\n')}\n}` : '{}'
  if (!gate) return commonType
  const gateParam = params.find((param) => param.name === gate.field)
  const fallback = defaultGateValue(candidates, gate.field)
  const variants = gate.variants.map((variant) => {
    const optional = fallback !== undefined && variant.values.includes(fallback)
    const lines: string[] = [
      ...jsdoc(gateParam?.doc ?? [], '    '),
      `    ${propertyKey(gate.field)}${optional ? '?' : ''}: ${union(variant.values.map(literal))}`,
    ]
    for (const { name, required } of variant.params) {
      const param = params.find((candidate) => candidate.name === name)
      if (!param) continue
      const doc = param.doc.filter((line) => !line.startsWith('@when'))
      lines.push(...renderProperty({ ...param, doc }, isRequired(param, required), '    '))
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
  const context = buildVisibilityContext(candidates, pinnedValues(entry))
  const coreParams = new Set(entry.special?.coreParams ?? [])
  const aliases = paramAliases(block, entry.builder.triggerMode === true)
  const params: Param[] = []
  for (const [name, members] of groupParams(candidates)) {
    if (coreParams.has(name)) continue
    const visibility = classifyParam(members, context)
    if (visibility.kind === 'never') continue
    let type = union(
      members.flatMap((member) => {
        const mapped = mapSubBlock(member)
        return mapped ? [mapped.type] : []
      })
    )
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

function builderTypes(catalog: BlockCatalog, entry: BuilderEntry): BuilderTypes {
  const block = catalogBlock(catalog, entry.builder.type)
  if (!block) {
    throw new Error(`sdk codegen: builder \`${entry.key}\` names unknown block type`)
  }
  const outputs = outputSource(catalog, block, entry)
  const spec = block.dynamicOutputs ?? null
  const plan = spec && !entry.special ? dynamicOutputPlan(spec, outputs) : null
  const { params, gate, candidates, context } = buildParams(block, entry, plan)
  const paramsName = `${entry.typeName}Params`
  const outputName = `${entry.typeName}Output`
  const generic = typeParameterList(plan, false)
  const genericArgs = plan ? `<${plan.typeParameter.name}>` : ''
  const outputGeneric = plan && Object.keys(plan.outputOverrides).length > 0
  const members = builderOutputs(outputs, context, plan?.outputOverrides ?? {})
  const paramsDeclaration = `export type ${paramsName}${generic} = ${renderParamsType(params, gate, candidates)}`
  const output: BuilderOutput = {
    name: outputName,
    typeParameters: outputGeneric ? generic : '',
    typeArguments: outputGeneric ? genericArgs : '',
    body: renderMembers(members, '  ').join('\n'),
  }
  const outputRef = `${outputName}${outputGeneric ? genericArgs : ''}`
  const outputType = plan?.outputExtension ? `${outputRef} & ${plan.outputExtension}` : outputRef
  const method = entry.path[entry.path.length - 1]
  const label = entry.builder.operation ? operationLabel(block, entry.builder.operation) : undefined
  const summary = [
    `${block.name}${label ? `: ${label}` : ''}`,
    entry.builder.operation ? `(operation \`${entry.builder.operation}\`)` : '',
    entry.builder.triggerMode ? '(trigger mode)' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const signature = entry.special
    ? []
    : [
        ...jsdoc([summary], ''),
        `export function ${method}${typeParameterList(plan, true)}(name: string, params: ${paramsName}${genericArgs}, meta?: BlockMeta): Block<${outputType}>`,
      ]
  const tool =
    !entry.special &&
    block.category === 'tools' &&
    !entry.builder.triggerMode &&
    entry.path.length > 1
      ? [
          ...jsdoc([`${summary}, as an agent tool`], ''),
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
    exportedTypes: [paramsName, outputName],
  }
}

function stripComments(text: string): string {
  return text.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function coreImports(text: string): string {
  const code = stripComments(text)
  const used = CORE_TYPE_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(code))
  return used.length > 0 ? `import type { ${used.join(', ')} } from '@sim/workflow-sdk'\n` : ''
}

interface NamespaceNode {
  functions: string[][]
  tools: string[][]
  children: Map<string, NamespaceNode>
}

function emptyNode(): NamespaceNode {
  return { functions: [], tools: [], children: new Map() }
}

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
    lines.push(`export namespace ${name} {`)
    lines.push(...indentLines(renderNamespace(child), '  '))
    lines.push('}')
  }
  return lines
}

function safeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
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
 * (`SlackV2Output`, `SlackV2Output2`, ...) so per-operation files alias them instead of repeating
 * a block-wide output list.
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

function generateBlockFiles(
  catalog: BlockCatalog,
  type: string,
  entries: readonly BuilderEntry[]
): SdkTypeFile[] {
  const files: SdkTypeFile[] = []
  const root = emptyNode()
  const inlineDeclarations: string[] = []
  const operationImports: string[] = []
  const specials: string[] = []
  const usedOperationFiles = new Set<string>()
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
    const declarations = [types.params, '', outputDeclaration]
    if (entry.builder.operation !== undefined) {
      let base = safeFileSegment(entry.builder.operation)
      if (usedOperationFiles.has(base)) base = `${base}.${entry.typeName}`
      usedOperationFiles.add(base)
      const body = declarations.join('\n')
      const sharedImport = sharedOutput
        ? `import type { ${sharedOutput.name} } from '../../blocks/${type}'\n`
        : ''
      files.push({
        path: `operations/${type}/${base}.d.ts`,
        text: `${header(catalog.sdkMajor)}\n${coreImports(body)}${sharedImport}\n${body}\n`,
      })
      operationImports.push(
        `import type { ${types.exportedTypes.join(', ')} } from '../operations/${type}/${base}'`
      )
    } else {
      inlineDeclarations.push(...declarations, '')
    }
    let node = root
    for (const segment of entry.path.slice(0, -1)) {
      let child = node.children.get(segment)
      if (!child) {
        child = emptyNode()
        node.children.set(segment, child)
      }
      node = child
    }
    if (types.signature.length > 0) node.functions.push(types.signature)
    if (types.tool) node.tools.push(types.tool)
    if (types.special) specials.push(types.special)
  }
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
  const imports = [coreImports(`${declarations}\n${augmentation}`).trimEnd(), ...operationImports]
    .filter(Boolean)
    .join('\n')
  files.push({
    path: `blocks/${type}.d.ts`,
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
  })
  return files
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
  const members = modelIds(catalog).map((id) => `    ${quote(id)}: true`)
  const body =
    members.length > 0 ? ['  interface ModelIds {', ...members, '  }'] : ['  interface ModelIds {}']
  return {
    path: 'models.d.ts',
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

/** Generates every `.d.ts` file for a catalog, sorted by path. */
export const generateSdkTypes: GenerateSdkTypesFn = (catalog) => {
  const byType = new Map<string, BuilderEntry[]>()
  for (const entry of builderEntries(catalog)) {
    const list = byType.get(entry.builder.type)
    if (list) list.push(entry)
    else byType.set(entry.builder.type, [entry])
  }
  const types = [...byType.keys()].sort(compareStrings)
  const files: SdkTypeFile[] = [generateModelsFile(catalog)]
  for (const type of types) {
    files.push(...generateBlockFiles(catalog, type, byType.get(type) ?? []))
  }
  files.push({
    path: 'index.d.ts',
    text: [
      `${HEADER_PREFIX} ${catalog.sdkMajor} · generated from block catalog ${catalog.hash}; do not edit`,
      `import './models'`,
      ...types.map((type) => `import './blocks/${type}'`),
      '',
      'export {}',
      '',
    ].join('\n'),
  })
  return files.sort((a, b) => compareStrings(a.path, b.path))
}
