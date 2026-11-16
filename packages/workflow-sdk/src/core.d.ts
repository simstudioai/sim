/**
 * The authoring surface for Sim workflows written as TypeScript.
 *
 * Nothing declared here runs. `@sim/workflow-code` compiles a workflow file statically, and every
 * runtime export of this package throws `SimSdkNotExecutable`. These declarations exist so an
 * editor, `tsgo --noEmit` or an agent can check a workflow file before the compiler sees it.
 *
 * Block builders (`slack.sendMessage`, `agent`, `trigger.gmail.poller`, ...) are not declared here:
 * they are generated from the block catalog into `blocks/{type}.d.ts`, which augment this module.
 * The generic `block(type, name, params)` covers any stored type without a builder.
 *
 * Every workflow file starts with the SDK header line, before any import:
 *
 * ```ts
 * // @sim-sdk 1
 * import { agent, trigger, workflow } from '@sim/workflow-sdk'
 * ```
 *
 * The number is the SDK major version the file is written against. A file without the header is
 * refused with `E_SDK_HEADER`, and one written for a newer major than the server supports with
 * `E_SDK_MAJOR`.
 */

/** Plain JSON. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

declare const REF: unique symbol
declare const TEMPLATE: unique symbol
declare const ENV: unique symbol
declare const RESOURCE: unique symbol
declare const TOOL: unique symbol
declare const NODE: unique symbol
declare const CODE_FILE: unique symbol
declare const RAW: unique symbol

/** Any reference, whatever it points at. */
export interface AnyRef {
  readonly [REF]: unknown
}

type RefPaths<T> = [Json] extends [T]
  ? { readonly [key: string]: Ref<Json> }
  : T extends readonly (infer E)[]
    ? { readonly [index: number]: Ref<E>; readonly length: Ref<number> }
    : T extends object
      ? { readonly [K in keyof T]-?: Ref<T[K]> }
      : unknown

/**
 * A typed reference to a block output, compiled to `<blockkey.path>`.
 * Paths map exactly: `.seg`, `['seg']` and `[n]`. Untyped JSON allows any path.
 */
export type Ref<T> = { readonly [REF]: T } & RefPaths<T>

/** Text with references in it, written with one of the tags below. */
export type Template = string & { readonly [TEMPLATE]: true }

/** A workspace environment variable, compiled to `{{NAME}}`. */
export interface EnvRef {
  readonly [ENV]: string
}

/** A param value: a literal, a reference, a template or an environment variable. */
export type Value<T> = T | AnyRef | Template | EnvRef

/** JSON whose leaves may be references, templates or environment variables. */
export type JsonWithRefs =
  | null
  | boolean
  | number
  | string
  | AnyRef
  | Template
  | EnvRef
  | JsonWithRefs[]
  | { [key: string]: JsonWithRefs }

/** A literal union that still accepts any other string (option ids read from values). */
export type LiteralUnion<T extends string> = T | (string & {})

/** A `time-input` value, `HH:MM`. */
export type TimeString = `${number}:${number}`

type Interpolation = AnyRef | EnvRef | VarRef | string | number | boolean

/** Text with interpolated references: `` t`New ${cls.category} ticket` ``. */
export declare function t(strings: TemplateStringsArray, ...values: Interpolation[]): Template
/** JavaScript code (condition expressions, inline function code). */
export declare const js: typeof t
/** Python code. */
export declare const py: typeof t
/** Shell code. */
export declare const sh: typeof t
/**
 * JSON text kept verbatim, for bodies an object literal cannot reproduce byte for byte. In a JSON
 * field an object literal is the usual form: a bare reference keeps its value's type (`n: score.value`
 * is a number), and a template is text.
 */
export declare const json: typeof t
/** Markdown text (note content). */
export declare const md: typeof t

/** A reference with a non-canonical spelling, such as `ref('Classify.content')`. */
export declare function ref(path: string): Ref<Json>

/** A stored value outside the generated type (a legacy option id, say), kept verbatim. */
export declare function raw<T = never>(value: unknown): T & { readonly [RAW]: true }

/** A required value that is still missing; compiles to absent, so canvas drafts type-check. */
export declare function todo(): never

/**
 * Keeps the value the stored workflow holds for this param, without showing it: the printer writes
 * it for a secret pasted into a password field. Valid only on a param of a block the stored
 * workflow already has (same name and type) and holds a value for; anything else is
 * `E_STORED_VALUE_MISSING`.
 */
export declare function stored(): never

/** Function code kept in a file next to the workflow (`.js`, `.py` or `.sh`), stored verbatim. */
export interface CodeFileRef {
  readonly [CODE_FILE]: string
}
export declare function codeFile(path: `./${string}`): CodeFileRef

/**
 * Environment variable names known to the workspace. `workspace.d.ts` adds one member per name;
 * until it exists `env` accepts any name.
 */
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the merge target generated declarations augment
export interface WorkspaceEnv {}

export declare const env: keyof WorkspaceEnv extends never
  ? { readonly [name: string]: EnvRef }
  : { readonly [K in keyof WorkspaceEnv]: EnvRef }

/**
 * Workspace resources by stable key, filled in by the generated `workspace.d.ts`. Each map's
 * values describe the resource: a table's row type, a credential's provider, a workflow's inputs.
 */
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the merge target generated declarations augment
export interface WorkspaceTables {}
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the merge target generated declarations augment
export interface WorkspaceKnowledgeBases {}
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the merge target generated declarations augment
export interface WorkspaceCredentials {}
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the merge target generated declarations augment
export interface WorkspaceWorkflows {}

type KeyOf<M> = keyof M extends never ? string : Extract<keyof M, string>

export type TableKey = KeyOf<WorkspaceTables>
export type KnowledgeBaseKey = KeyOf<WorkspaceKnowledgeBases>
export type CredentialKey = KeyOf<WorkspaceCredentials>
export type WorkflowKey = KeyOf<WorkspaceWorkflows>

/** A workspace resource by stable key, compiled to the resource's internal id. */
export interface ResourceRef<Kind extends string, Key extends string = string> {
  readonly [RESOURCE]: Kind
  readonly key: Key
}

/** A saved credential: `credential('support-slack')`. */
export type CredentialRef<Key extends string = string> = ResourceRef<'credential', Key>
export declare function credential<K extends CredentialKey>(key: K): CredentialRef<K>

/** The columns of a workspace table, or loose JSON when `workspace.d.ts` does not know it. */
export type TableColumns<K extends string> = K extends keyof WorkspaceTables
  ? WorkspaceTables[K]
  : { [column: string]: Json }
/** One stored row: its columns plus the row id. */
export type TableRow<K extends string> = TableColumns<K> & { id: string }
/** Column values written to a row. */
export type TableData<K extends string> = K extends keyof WorkspaceTables
  ? { [C in keyof WorkspaceTables[K]]?: Value<WorkspaceTables[K][C]> | JsonWithRefs }
  : { [column: string]: JsonWithRefs }

/** A workspace table: `table('leads')`. Table block operations live on `table.*`. */
export type TableRef<Key extends string = string> = ResourceRef<'table', Key>
export declare function table<K extends TableKey>(key: K): TableRef<K>

/** A knowledge base: `knowledgeBase('docs')`. */
export type KnowledgeBaseRef<Key extends string = string> = ResourceRef<'knowledge-base', Key>
export declare function knowledgeBase<K extends KnowledgeBaseKey>(key: K): KnowledgeBaseRef<K>

/** A workspace skill: `skill('triage')`. */
export type SkillRef = ResourceRef<'skill'>
export declare function skill(key: string): SkillRef

/** A sandbox image: `sandbox('node-ml')`. */
export type SandboxRef = ResourceRef<'sandbox'>
export declare function sandbox(key: string): SandboxRef

/** A workspace folder: `folder('reports')`. */
export type FolderRef = ResourceRef<'file-folder'>
export declare function folder(key: string): FolderRef

/** A workspace file: `file('contracts/acme.pdf')`. File block operations live on `file.*`. */
export type FileRef = ResourceRef<'file'>
export declare function file(path: string): FileRef

/** A file produced at run time (`file` / `file[]` outputs). */
export interface SimFile {
  id: string
  name: string
  url: string
  size: number
  type: string
  key: string
}

// Agent tools

/** One entry of an agent's `tools` list. */
export interface Tool {
  readonly [TOOL]: true
}

/** How the model may use a tool, and the stored tool fields a print carries. */
export interface ToolOpts {
  usageControl?: 'auto' | 'force' | 'none'
  usageControlExpression?: string
  title?: string
  /** The stored operation, when the method does not pin it. */
  operation?: string
  toolId?: string
  /** Pair modes of the tool's params, which pick the member the agent reads. */
  modes?: Record<string, 'basic' | 'advanced'>
  customTool?: JsonWithRefs
  operationPolicy?: Json
  /** Unknown stored tool keys, kept verbatim. */
  extra?: Json
}

/**
 * A workspace custom tool by key, as an agent tool: `customTool('lookup-order')`. A stored tool
 * whose definition was copied into the workflow (and may have drifted from the workspace tool)
 * prints as `raw(tool)` instead.
 */
export declare function customTool(key: string, options?: ToolUsage): Tool

/** How the model may use a tool the SDK writes by name (`customTool`, `mcp().tool`, `asTool`). */
export type ToolUsage = Pick<ToolOpts, 'usageControl' | 'usageControlExpression'>

/** An MCP tool's arguments and the editor's snapshot of its server. */
export interface McpToolOpts extends ToolUsage {
  /** Argument values the workflow fixes; the model fills in the rest. */
  args?: Record<string, JsonWithRefs>
  /**
   * What the editor saved about the server and the tool's input schema when the tool was picked.
   * Shown in the editor; never run.
   */
  snapshot?: { serverName?: string; serverUrl?: string; schema?: Json }
}

/** An MCP server by key: `mcp('linear')`. */
export interface McpServerRef extends ResourceRef<'mcp-server'> {
  /** One of the server's tools, as an agent tool: `mcp('linear').tool('create_issue')`. */
  tool(name: string, options?: McpToolOpts): Tool
}
export declare function mcp(key: string): McpServerRef

// Graph

/** Block-level fields (`BlockState`), written as the third builder argument. */
export interface BlockMeta {
  /**
   * A legacy key the display name cannot carry (a `name~n` collision key or a reserved name such
   * as `Loop`). Printed only for such a stored block; apply accepts it only for a key the stored
   * workflow already has, so it can never introduce one.
   */
  key?: string
  /** Stored as `enabled: false`. */
  disabled?: true
  /** Locked: apply refuses any change to this block. */
  locked?: true
  /** Exposes the error port without an `onError` edge. */
  errorPort?: boolean
  /** The block-level advanced toggle (`advancedMode`). */
  advancedMode?: boolean
  /**
   * Runs the block as its trigger (`triggerMode`). Trigger builders (`trigger.gmail.poller`) set
   * it themselves; write it on any other builder only for a block stored in trigger mode.
   */
  triggerMode?: boolean
  /** The stored retry policy, written whole. */
  retry?: BlockRetryConfig
  /**
   * Per branch key of a condition or router, the row's display `title` and any stored fields the
   * SDK has no syntax for (`extra`, plain JSON). `title: null` keeps a row stored with no title,
   * which the executor never takes for `else`.
   */
  branches?: Record<string, { title?: string | null; extra?: Record<string, Json> }>
  /**
   * Stored params that run but have no SDK syntax: a schema-agnostic custom block's inputs, the
   * agent's legacy prompt fields, a container's stored params. Values the block keeps but never
   * runs are not written; apply keeps them from the stored workflow.
   */
  extra?: Record<string, unknown>
  /**
   * A loop or parallel's `block.data` subflow keys the loader could not read as config, kept
   * verbatim (plain JSON).
   */
  subflowData?: Record<string, Json>
}

/** A block's retry policy, field for field the stored `BlockRetryConfig`. */
export interface BlockRetryConfig {
  /** Absent config and `false` mean the same thing: the block runs once. */
  enabled: boolean
  /** Total tries including the first. */
  maxTries: number
  /** Delay between tries. */
  waitBetweenTriesMs: number
}

/** Anything an edge can point at. */
export type Target = Node | Group

/** A block or container in the graph. */
export interface Node {
  readonly [NODE]: true
  /** Wires this node's default port to each target. Returns the target, or a group of them. */
  to<const T extends Target[]>(...targets: T): T extends [infer One] ? One : Group
  /** Wires this node's error port to each target. */
  onError(...targets: Target[]): void
}

/** Several nodes; `.to()` wires every member (fan-in). */
export interface Group {
  to(...targets: Target[]): Group
}

/** A block: a node whose outputs can be referenced. */
export type Block<O> = Node & Ref<O>

/** The named ports of a condition or router. */
export type Branches<K extends string> = { readonly [P in K]: Node }

/** Trigger builders (`trigger.start`, `trigger.gmail.poller`, ...), generated from the catalog. */
export declare namespace trigger {}

/** Builders for hidden legacy block versions (`legacy.slack.send`), generated from the catalog. */
export declare namespace legacy {}

/** A raw edge from a handle the SDK has no name for (a legacy or unknown port). */
export declare function edge(from: Node, handle: string, to: Target): void

/** Any stored block type without a builder (legacy, unknown or custom), with untyped outputs. */
export declare function block(
  type: string,
  name: string,
  params: Record<string, unknown>,
  meta?: BlockMeta
): Block<Json>

// Workflow and variables

export type VariableType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'plain'

export interface VariableDeclaration {
  /** The display name, written only when it differs from the key. */
  name?: string
  type: VariableType
  value: Json
}

export type VariableDeclarations = Record<string, VariableDeclaration>

declare const VAR: unique symbol

/** A workflow variable, compiled to `<variable.name>`. */
export interface VarRef {
  readonly [VAR]: string
}

type VariableValue<T extends VariableType> = T extends 'number'
  ? number
  : T extends 'boolean'
    ? boolean
    : T extends 'string' | 'plain'
      ? string
      : Json

export type VarRefs<V extends VariableDeclarations> = {
  readonly [K in keyof V]: VarRef & Ref<VariableValue<V[K]['type']>>
}

/**
 * Workflow variables by name, untyped. Prefer the `vars` the `workflow()` body receives, which is
 * typed from the declared variables.
 */
export declare const vars: { readonly [name: string]: VarRef & Ref<Json> }

declare const WORKFLOW_DEF: unique symbol

/** The default export of a workflow file. */
export interface WorkflowDef {
  readonly [WORKFLOW_DEF]: true
}

/** A child workflow by key, for `runWorkflow` or as an agent tool. */
export interface WorkflowRef<Key extends string = string> extends ResourceRef<'workflow', Key> {
  /**
   * The workflow as an agent tool, as the editor's tool picker adds it:
   * `childWorkflow('enrich-lead').asTool()`. A tool with fixed inputs is written
   * `runWorkflow.tool({ workflowId, inputMapping }, options)`.
   */
  asTool(options?: ToolUsage): Tool
}

/**
 * Declares a workflow. The body wires blocks; it never runs. With no description or variables the
 * options may be left out: `workflow('Name', () => { ... })`.
 */
export declare function workflow<const V extends VariableDeclarations = Record<never, never>>(
  name: string,
  options: { description?: string; variables?: V },
  body: (scope: { vars: VarRefs<V> }) => void
): WorkflowDef
export declare function workflow(
  name: string,
  body: (scope: { vars: VarRefs<Record<never, never>> }) => void
): WorkflowDef
/** A child workflow by key: `childWorkflow('enrich-lead')`. */
export declare function childWorkflow<K extends WorkflowKey>(key: K): WorkflowRef<K>

// Containers

type ItemOf<C> = C extends { readonly [REF]: readonly (infer E)[] }
  ? E
  : C extends readonly (infer E)[]
    ? E
    : Json

/** Inside a loop or parallel body. As a node it is the container's start port: `p.to(first)`. */
export interface SubflowScope<Item> extends Node {
  readonly index: Ref<number>
  readonly currentItem: Ref<Item>
  readonly items: Ref<Item[]>
}

/**
 * A container's outputs, plus its iteration fields by name (`outer.index`), which is how a block
 * in a nested container reads an outer loop's index or item.
 */
export interface SubflowOutput {
  results: Json[]
  index: number
  currentItem: Json
  items: Json[]
}

/** A loop or parallel container. Its `.to()` wires the port taken after it finishes. */
export type Container = Block<SubflowOutput>

type Collection = AnyRef | Template | Json[] | string

export declare const loop: {
  for(
    name: string,
    params: { count?: number },
    body: (scope: SubflowScope<never>) => void,
    meta?: BlockMeta
  ): Container
  forEach<const C extends Collection>(
    name: string,
    params: { collection: C },
    body: (scope: SubflowScope<ItemOf<C>>) => void,
    meta?: BlockMeta
  ): Container
  while(
    name: string,
    params: { condition: Template | string },
    body: (scope: SubflowScope<never>) => void,
    meta?: BlockMeta
  ): Container
  doWhile(
    name: string,
    params: { condition?: Template | string; count?: number },
    body: (scope: SubflowScope<never>) => void,
    meta?: BlockMeta
  ): Container
}

export declare const parallel: {
  /** A parallel with no stored type, which the loader runs as `count`. */
  (
    name: string,
    params: { count?: number; collection?: Collection; batchSize?: number },
    body: (scope: SubflowScope<Json>) => void,
    meta?: BlockMeta
  ): Container
  count(
    name: string,
    params: { count: number; batchSize?: number },
    body: (scope: SubflowScope<never>) => void,
    meta?: BlockMeta
  ): Container
  collection<const C extends Collection>(
    name: string,
    params: { collection: C; batchSize?: number },
    body: (scope: SubflowScope<ItemOf<C>>) => void,
    meta?: BlockMeta
  ): Container
}

// Blocks with a source form of their own

/**
 * Params and outputs of the blocks below, generated from the catalog. Each entry is
 * `{ params; output }`; without generated types the params are loose.
 */
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the merge target generated declarations augment
export interface SpecialBuilderTypes {}

type SpecialParams<K extends string> = K extends keyof SpecialBuilderTypes
  ? SpecialBuilderTypes[K] extends { params: infer P }
    ? P
    : never
  : Record<string, unknown>

type SpecialOutput<K extends string> = K extends keyof SpecialBuilderTypes
  ? SpecialBuilderTypes[K] extends { output: infer O }
    ? O
    : never
  : Json

/** A condition expression, or `true` for the `else` branch. */
export type BranchExpression = Template | string | true

/**
 * Keys of a condition written with no rows (`condition('Name', {})`, the source form of rows
 * that were never persisted): the implicit `if` and `else` ports stay addressable.
 */
type ConditionKeys<B> = keyof B extends never ? 'if' | 'else' : Extract<keyof B, string>
type RouterKeys<R> = keyof R extends never ? 'route0' : Extract<keyof R, string>

/** A condition: named branches, the last one `else` when there are two or more. */
export declare function condition<const B extends Record<string, BranchExpression>>(
  name: string,
  branches: B,
  meta?: BlockMeta
): Block<SpecialOutput<'condition'>> & Branches<ConditionKeys<B>>

/** A router: named routes described for the model. */
export declare function router<const R extends Record<string, string | Template>>(
  name: string,
  params: SpecialParams<'router'> & { routes: R },
  meta?: BlockMeta
): Block<SpecialOutput<'router'>> & Branches<RouterKeys<R>>

/** A function block. `code` is inline (`` js`...` ``) or a code file (`codeFile('./functions/x.js')`). */
export declare function fn(
  name: string,
  params: SpecialParams<'fn'> & { code: Template | CodeFileRef | string },
  meta?: BlockMeta
): Block<SpecialOutput<'fn'>>

/** Runs a child workflow. */
export declare function runWorkflow(
  name: string,
  params: SpecialParams<'runWorkflow'>,
  meta?: BlockMeta
): Block<SpecialOutput<'runWorkflow'>>

/** Pauses for a person; the form in `inputFormat` types `submission`. */
export declare function human<const F extends InputFields = Record<never, never>>(
  name: string,
  params: SpecialParams<'human'> & { inputFormat?: F },
  meta?: BlockMeta
): Block<Omit<SpecialOutput<'human'>, 'submission'> & { submission: InputFieldsOutput<F> }>

/**
 * A response's body, status and headers: the editor's JSON mode. An object or array `body` is
 * JSON whose references keep their types; a template or reference is the body text as written.
 */
export interface ResponseBody {
  body: JsonWithRefs
  /** HTTP status; 200 when omitted. */
  status?: number | Value<string>
  /** Response headers by name. */
  headers?: Record<string, Value<string>>
}

/**
 * Ends the workflow with an API response: `response('Reply', { body: { ok: true }, status: 201 })`,
 * or the block's own params (`dataMode`, `builderData`, ...) when the body is built field by field.
 */
export declare function response(
  name: string,
  params: ResponseBody | SpecialParams<'response'>,
  meta?: BlockMeta
): Block<SpecialOutput<'response'>>

/** Assigns workflow variables. */
export declare function setVariables(
  name: string,
  params: SpecialParams<'setVariables'>,
  meta?: BlockMeta
): Block<SpecialOutput<'setVariables'>>

declare const ANNOTATION: unique symbol

/** A canvas note: no edges, no outputs. */
export interface Annotation {
  readonly [ANNOTATION]: true
}
export declare function note(
  name: string,
  params: SpecialParams<'note'>,
  meta?: BlockMeta
): Annotation

// Structured param shapes

/** Type names an input-format field may declare. */
export type InputFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file[]'

/** A structured input field: its type plus a default value, description or required flag. */
export interface InputFieldSpec {
  type: InputFieldType
  value?: JsonWithRefs
  description?: string
  required?: boolean
}

/** `input-format` fields by name: `{ subject: 'string', amount: { type: 'number', value: 0 } }`. */
export type InputFields = Record<string, InputFieldType | InputFieldSpec>

type InputFieldValue<T> = T extends 'string'
  ? string
  : T extends 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'array'
        ? Json[]
        : T extends 'file[]'
          ? SimFile[]
          : Json

/** The outputs an `input-format` declares. */
export type InputFieldsOutput<F> = {
  [K in keyof F]: F[K] extends { type: infer T } ? InputFieldValue<T> : InputFieldValue<F[K]>
}

/**
 * One `response-format` field as the editor's builder stores it. An `object` or `array` field's
 * `value` may hold nested fields. A response is usually written with `body` instead.
 */
export interface ResponseField {
  id?: string
  name: string
  type: string
  value?: JsonWithRefs
  collapsed?: boolean
}

/** `response-format` fields: `[{ name: 'ok', type: 'boolean', value: true }]`. */
export type ResponseFields = ResponseField[]

/** An agent message. */
export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: Value<string>
}

/** One `variables-input` assignment, with any other stored keys kept. */
export interface VariableAssignment {
  variableId: VarRef
  value?: JsonWithRefs
  [key: string]: JsonWithRefs | VarRef | undefined
}

/** Child workflow inputs by name (`input-mapping`, `workflow-input-mapper`). */
export type InputMapping = Record<string, JsonWithRefs>

/** A table filter by column: `{ status: { $eq: 'new' } }`. */
export type Filter = Record<string, JsonWithRefs>

/** A table sort by column: `{ createdAt: 'desc' }`. */
export type Sort =
  | Record<string, 'asc' | 'desc'>
  | Array<{ column: string; direction: 'asc' | 'desc' }>

/** One knowledge tag filter. */
export interface TagFilter {
  tagName: string
  tagValue: Value<string>
  [key: string]: JsonWithRefs
}

/** One document tag. */
export interface DocumentTag {
  tagName: string
  value: Value<string>
  [key: string]: JsonWithRefs
}

/** One `eval-input` metric. */
export interface EvalMetric {
  name: string
  description?: string
  range?: { min: number; max: number }
  [key: string]: JsonWithRefs | undefined
}

/** One `model-fallback-list` entry. */
export interface ModelFallback {
  model: LiteralUnion<Model>
  [key: string]: JsonWithRefs
}

/**
 * Model ids, generated into `models.d.ts` (which adds one member per model). Kept apart from the
 * block files so a model-list change touches one file.
 */
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the merge target generated declarations augment
export interface ModelIds {}
export type Model = Extract<keyof ModelIds, string>

/** A JSON Schema `responseFormat`, or `{ name, strict, schema }` around one. */
export type ResponseFormat = JsonWithRefs

type Depth = [never, 0, 1, 2, 3, 4]

type FromSchema<S, D extends number> = [D] extends [never]
  ? Json
  : S extends { enum: readonly (infer E)[] }
    ? E
    : S extends { type: 'object'; properties: infer P }
      ? { [K in keyof P]: FromSchema<P[K], Depth[D]> }
      : S extends { type: 'array'; items: infer I }
        ? FromSchema<I, Depth[D]>[]
        : S extends { type: 'string' }
          ? string
          : S extends { type: 'number' | 'integer' }
            ? number
            : S extends { type: 'boolean' }
              ? boolean
              : Json

/**
 * The outputs a literal `responseFormat` adds, read from its JSON Schema with recursion capped at
 * depth 4. A template or reference adds untyped JSON.
 */
export type ResponseFormatOutput<RF> = [RF] extends [undefined]
  ? unknown
  : RF extends { schema: infer S }
    ? FromSchema<S, 4>
    : RF extends { type: 'object'; properties: object }
      ? FromSchema<RF, 4>
      : { [key: string]: Json }
