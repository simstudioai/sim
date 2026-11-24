/**
 * The one reader of declaration files (`tables/<key>.ts`, `tools/<key>.ts`, …). A declaration is
 * a TypeScript module the server parses and never runs:
 *
 * ```ts
 * // @sim-sdk 1
 * import { column, defineTable } from '@sim/workflow-sdk/workspace'
 *
 * export default defineTable({ name: 'Leads', columns: { email: column.string() } })
 * ```
 *
 * Its argument may hold only JSON literals (strings, template literals without `${}`, finite
 * numbers, booleans, `null`, arrays and objects with plain keys) and the helper calls the kind
 * names, each read as `{ $call: 'column.string', args: [...] }`. Every value's span is kept by its
 * JSON Pointer, so a kind's validator reports at the line that holds the value.
 */
import { type ParserOptions, parse } from '@babel/parser'
import type { Expression, Node, ObjectExpression } from '@babel/types'
import { isRecordLike } from '@sim/utils/object'
import { utf8ByteLength } from '@sim/utils/paste'
import { containsNulCharacter, toWellFormed } from '@sim/utils/string'
import {
  babelErrorShape,
  babelMessage,
  bracketDepthOverflow,
  type Json,
  pointerSegment,
  type SourceSpan,
  sdkHeader,
} from '@sim/workflow-code'
import {
  diagnostic,
  findingLimitReached,
  MAX_FINDINGS_PER_FILE,
  sourceLocator,
  type WorkspaceDiagnostic,
} from '../diagnostics'
import { WORKSPACE_SOURCE_LIMITS } from '../limits'

/** The module every declaration imports from. */
export const WORKSPACE_SDK_MODULE = '@sim/workflow-sdk/workspace'
/** The only SDK major declarations are written in. */
export const DECLARATION_SDK_MAJOR = 1
/** The key a helper call is read under; no declaration object may use it. */
export const CALL_KEY = '$call'
/** The key an `env.NAME` reference is read under; no declaration object may use it. */
export const ENV_KEY = '$env'

/** A helper call as the reader encodes it. */
export interface DeclarationCall {
  $call: string
  args: Json[]
}

/** An environment variable reference, `env.NAME`, as the reader encodes it: by name, never value. */
interface DeclarationEnvRef {
  $env: string
}

/**
 * Whether `key` may be an object key in a declaration: not `__proto__`, and not a key the reader
 * encodes a helper call or `env.NAME` under. A resource or entry named otherwise cannot be
 * declared, so a get leaves it out rather than print a file that does not read back.
 */
export function isDeclarableKey(key: string): boolean {
  return key !== CALL_KEY && key !== ENV_KEY && key !== '__proto__'
}

/** An environment variable name `env.NAME` may spell: an identifier. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

interface ReadDeclarationOptions {
  /** The function the file default-exports a call of: `defineTable`. */
  callee: string
  /** Helper calls a value may be (`column.string`, `codeFile`), by their dotted name. */
  calls?: ReadonlySet<string>
  /** Whether a value may be `env.NAME`, an environment variable by name (`DeclarationEnvRef`). */
  env?: boolean
}

interface ReadDeclaration {
  /** The default export's argument, when the file reads. */
  value?: Json
  /** JSON Pointer → span of the value at it (`''` is the whole argument). */
  spans: Map<string, SourceSpan>
  diagnostics: WorkspaceDiagnostic[]
}

const PARSER_OPTIONS: ParserOptions = {
  sourceType: 'module',
  plugins: ['typescript'],
  errorRecovery: false,
  ranges: false,
  tokens: false,
}

/** Whether a decoded value is a helper call the reader produced. */
export function isDeclarationCall(value: unknown): value is DeclarationCall {
  return isRecordLike(value) && typeof value[CALL_KEY] === 'string' && Array.isArray(value.args)
}

/** Whether a decoded value is an `env.NAME` reference the reader produced. */
export function isDeclarationEnvRef(value: unknown): value is DeclarationEnvRef {
  return isRecordLike(value) && typeof value[ENV_KEY] === 'string' && ENV_NAME.test(value[ENV_KEY])
}

/**
 * Why a decoded value that is a helper call or an `env.NAME` reference is not an object, or `null`
 * when it is neither. The reader encodes both as records, so an object check must ask this first.
 */
export function notAnObject(value: Json | undefined): { message: string; hint: string } | null {
  if (isDeclarationEnvRef(value)) {
    return {
      message: `is \`env.${value.$env}\`, one value`,
      hint: `Put it under a key: \`{ <name>: env.${value.$env} }\`.`,
    }
  }
  if (isDeclarationCall(value)) {
    return {
      message: `is \`${value.$call}()\`, a helper value`,
      hint: 'Write the object itself: `{ <name>: <value> }`.',
    }
  }
  return null
}

/** Why `text` cannot be stored (a NUL, an unpaired UTF-16 surrogate), or `null` when it can. */
export function unstorableCharacter(text: string): string | null {
  if (containsNulCharacter(text)) return 'a NUL character'
  return toWellFormed(text) === text ? null : 'an unpaired surrogate'
}

/** The dotted name of a call's callee (`column.string`, `codeFile`), or `null` otherwise. */
function calleeName(node: Node): string | null {
  if (node.type === 'Identifier') return node.name
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.object.type === 'Identifier' &&
    node.property.type === 'Identifier'
  ) {
    return `${node.object.name}.${node.property.name}`
  }
  return null
}

const BYTE_ORDER_MARK = '\uFEFF'

/**
 * Parses one declaration file and decodes its default export's argument. Refuses (with every
 * finding located in `text`) a missing header, an import from anywhere but the workspace SDK, a
 * renamed import, anything beside the imports and the one default export, and any value outside
 * the grammar. Unused imports are accepted. A leading byte order mark is dropped first, as a
 * workflow compile drops it, and every span is into the text after it. Bytes and nesting are capped before Babel runs,
 * locating every value is linear in the file, and decoding stops at `MAX_FINDINGS_PER_FILE`.
 */
export function readDeclaration(
  file: string,
  raw: string,
  options: ReadDeclarationOptions
): ReadDeclaration {
  const text = raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(BYTE_ORDER_MARK.length) : raw
  const spans = new Map<string, SourceSpan>()
  const diagnostics: WorkspaceDiagnostic[] = []
  const locator = sourceLocator(file, text)
  const at = (start: number, end: number) => locator.located(locator.span(start, end))
  const nodeAt = (node: Node) => at(node.start ?? 0, node.end ?? node.start ?? 0)
  const fail = (): ReadDeclaration => ({ spans, diagnostics })

  const bytes = utf8ByteLength(text, WORKSPACE_SOURCE_LIMITS.maxDeclarationBytes)
  if (bytes > WORKSPACE_SOURCE_LIMITS.maxDeclarationBytes) {
    diagnostics.push(
      diagnostic(
        'E_LIMIT_EXCEEDED',
        `The file is larger than ${WORKSPACE_SOURCE_LIMITS.maxDeclarationBytes} bytes.`,
        { ...at(0, 0) }
      )
    )
    return fail()
  }
  const overflowAt = bracketDepthOverflow(text, WORKSPACE_SOURCE_LIMITS.maxDepth)
  if (overflowAt !== -1) {
    diagnostics.push(
      diagnostic(
        'E_LIMIT_EXCEEDED',
        `Nesting is deeper than ${WORKSPACE_SOURCE_LIMITS.maxDepth} levels.`,
        { ...at(overflowAt, overflowAt + 1), hint: 'Flatten the value.' }
      )
    )
    return fail()
  }
  const header = sdkHeader(text)
  if (header.sdkMajor !== DECLARATION_SDK_MAJOR) {
    diagnostics.push(
      diagnostic(
        'E_DECL_HEADER',
        `The first line must be \`// @sim-sdk ${DECLARATION_SDK_MAJOR}\`.`,
        {
          ...at(0, Math.max(1, header.headerEnd)),
        }
      )
    )
    return fail()
  }

  let program: ReturnType<typeof parse>['program']
  try {
    program = parse(text, PARSER_OPTIONS).program
  } catch (error) {
    if (error instanceof RangeError) {
      diagnostics.push(
        diagnostic('E_LIMIT_EXCEEDED', 'The file is nested too deeply to parse.', { ...at(0, 0) })
      )
      return fail()
    }
    const shape = babelErrorShape(error)
    const pos = typeof shape.pos === 'number' ? shape.pos : 0
    diagnostics.push(diagnostic('E_DECL_SYNTAX', babelMessage(shape), { ...at(pos, pos + 1) }))
    return fail()
  }

  let stopped = false
  const record = (finding: WorkspaceDiagnostic) => {
    if (stopped) return
    if (diagnostics.length >= MAX_FINDINGS_PER_FILE) {
      stopped = true
      diagnostics.push(findingLimitReached({ span: finding.span, frame: finding.frame }))
      return
    }
    diagnostics.push(finding)
  }

  const imported = new Set<string>()
  let exported: Expression | null = null
  for (const statement of program.body) {
    if (stopped) return fail()
    if (statement.type === 'ImportDeclaration') {
      if (statement.source.value !== WORKSPACE_SDK_MODULE || statement.importKind === 'type') {
        record(
          diagnostic('E_DECL_IMPORT', `Import only from '${WORKSPACE_SDK_MODULE}'.`, {
            ...nodeAt(statement),
          })
        )
        continue
      }
      for (const specifier of statement.specifiers) {
        const name =
          specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier'
            ? specifier.imported.name
            : null
        if (name === null || specifier.local.name !== name) {
          record(
            diagnostic('E_DECL_IMPORT', 'Import the SDK names as they are, without renaming.', {
              ...nodeAt(specifier),
            })
          )
          continue
        }
        imported.add(name)
      }
      continue
    }
    if (statement.type === 'ExportDefaultDeclaration' && exported === null) {
      const declaration = statement.declaration
      if (
        declaration.type === 'CallExpression' &&
        declaration.callee.type === 'Identifier' &&
        declaration.callee.name === options.callee &&
        declaration.arguments.length === 1 &&
        declaration.arguments[0].type !== 'SpreadElement' &&
        declaration.arguments[0].type !== 'ArgumentPlaceholder'
      ) {
        exported = declaration.arguments[0] as Expression
        continue
      }
    }
    record(
      diagnostic(
        'E_DECL_EXPORT',
        `The file holds only imports and one \`export default ${options.callee}({ … })\`.`,
        { ...nodeAt(statement) }
      )
    )
  }
  if (exported === null) {
    if (diagnostics.length === 0) {
      record(
        diagnostic(
          'E_DECL_EXPORT',
          `The file has no \`export default ${options.callee}({ … })\`.`,
          {
            ...at(0, 0),
          }
        )
      )
    }
    return fail()
  }
  if (!imported.has(options.callee)) {
    record(
      diagnostic('E_DECL_IMPORT', `Import ${options.callee} from '${WORKSPACE_SDK_MODULE}'.`, {
        ...at(0, 0),
      })
    )
  }

  const unsupported = (node: Node, message: string, hint?: string) => {
    record(
      diagnostic('E_DECL_UNSUPPORTED', message, {
        ...nodeAt(node),
        ...(hint ? { hint } : {}),
      })
    )
    return undefined
  }

  const readString = (node: Node, value: string): Json | undefined => {
    const problem = unstorableCharacter(value)
    return problem
      ? unsupported(node, `The string holds ${problem}, which cannot be stored.`)
      : value
  }

  const readObject = (node: ObjectExpression, pointer: string): Json | undefined => {
    const object: Record<string, Json> = {}
    let ok = true
    for (const property of node.properties) {
      if (property.type !== 'ObjectProperty' || property.computed || property.shorthand) {
        unsupported(property, 'Only `key: value` properties are supported.')
        ok = false
        continue
      }
      const key =
        property.key.type === 'Identifier'
          ? property.key.name
          : property.key.type === 'StringLiteral'
            ? property.key.value
            : null
      if (key === null || !isDeclarableKey(key)) {
        unsupported(
          property.key,
          key === null ? 'A key is a name or a quoted string.' : `"${key}" cannot be a key.`
        )
        ok = false
        continue
      }
      if (Object.hasOwn(object, key)) {
        record(
          diagnostic('E_DECL_DUPLICATE_KEY', `"${key}" is declared twice.`, {
            ...nodeAt(property.key),
          })
        )
        ok = false
        continue
      }
      const value = readValue(property.value, `${pointer}/${pointerSegment(key)}`)
      if (value === undefined) ok = false
      else object[key] = value
    }
    return ok ? object : undefined
  }

  const readValue = (node: Node, pointer: string): Json | undefined => {
    if (stopped) return undefined
    spans.set(pointer, locator.span(node.start ?? 0, node.end ?? 0))
    switch (node.type) {
      case 'StringLiteral':
        return readString(node, node.value)
      case 'TemplateLiteral': {
        if (node.expressions.length > 0) {
          return unsupported(node, 'A template literal cannot interpolate values.')
        }
        const cooked = node.quasis[0]?.value.cooked
        return typeof cooked === 'string'
          ? readString(node, cooked)
          : unsupported(node, 'The template literal has an invalid escape.')
      }
      case 'NumericLiteral':
        return Number.isFinite(node.value)
          ? node.value
          : unsupported(node, 'The number is not finite.')
      case 'UnaryExpression':
        if (node.operator === '-' && node.argument.type === 'NumericLiteral') {
          return Number.isFinite(node.argument.value)
            ? -node.argument.value
            : unsupported(node, 'The number is not finite.')
        }
        return unsupported(node, 'Only a negative number literal may use a unary operator.')
      case 'BooleanLiteral':
        return node.value
      case 'NullLiteral':
        return null
      case 'TSAsExpression':
        return node.typeAnnotation.type === 'TSTypeReference' &&
          node.typeAnnotation.typeName.type === 'Identifier' &&
          node.typeAnnotation.typeName.name === 'const'
          ? readValue(node.expression, pointer)
          : unsupported(node, 'Only `as const` is supported.')
      case 'ArrayExpression': {
        const items: Json[] = []
        let ok = true
        node.elements.forEach((element, index) => {
          if (element === null || element.type === 'SpreadElement') {
            unsupported(element ?? node, 'An array holds values only: no holes or spreads.')
            ok = false
            return
          }
          const value = readValue(element, `${pointer}/${index}`)
          if (value === undefined) ok = false
          else items.push(value)
        })
        return ok ? items : undefined
      }
      case 'ObjectExpression':
        return readObject(node, pointer)
      case 'MemberExpression': {
        if (
          !options.env ||
          node.computed ||
          node.object.type !== 'Identifier' ||
          node.object.name !== 'env' ||
          node.property.type !== 'Identifier'
        ) {
          return unsupported(
            node,
            'A declaration holds JSON values and SDK helper calls only.',
            options.env ? 'An environment variable is `env.NAME`.' : undefined
          )
        }
        if (!imported.has('env')) {
          record(
            diagnostic('E_DECL_IMPORT', `Import env from '${WORKSPACE_SDK_MODULE}'.`, {
              ...nodeAt(node.object),
            })
          )
          return undefined
        }
        return ENV_NAME.test(node.property.name)
          ? { [ENV_KEY]: node.property.name }
          : unsupported(
              node.property,
              `"${node.property.name}" is not an environment variable name.`
            )
      }
      case 'CallExpression': {
        const name = calleeName(node.callee)
        if (name === null || !options.calls?.has(name)) {
          return unsupported(
            node,
            name === null
              ? 'Only SDK helper calls are supported.'
              : `\`${name}()\` is not a helper here.`,
            options.calls && options.calls.size > 0
              ? `Supported: ${[...options.calls].map((call) => `${call}()`).join(', ')}.`
              : undefined
          )
        }
        const root = name.split('.')[0]
        if (!imported.has(root)) {
          record(
            diagnostic('E_DECL_IMPORT', `Import ${root} from '${WORKSPACE_SDK_MODULE}'.`, {
              ...nodeAt(node.callee),
            })
          )
          return undefined
        }
        const args: Json[] = []
        let ok = true
        node.arguments.forEach((argument, index) => {
          if (argument.type === 'SpreadElement' || argument.type === 'ArgumentPlaceholder') {
            unsupported(argument, 'A helper takes values only, not spreads.')
            ok = false
            return
          }
          const value = readValue(argument, `${pointer}/args/${index}`)
          if (value === undefined) ok = false
          else args.push(value)
        })
        return ok ? { [CALL_KEY]: name, args } : undefined
      }
      default:
        return unsupported(
          node,
          'A declaration holds JSON values and SDK helper calls only.',
          'Nothing in a declaration runs: write the value itself, not code that computes it.'
        )
    }
  }

  const value = readValue(exported, '')
  const helper = notAnObject(value)
  if (helper) {
    unsupported(
      exported,
      `${options.callee} takes an object, but this ${helper.message}.`,
      helper.hint
    )
  } else if (
    value !== undefined &&
    (typeof value !== 'object' || value === null || Array.isArray(value))
  ) {
    unsupported(exported, `${options.callee} takes an object.`)
  }
  return diagnostics.length > 0 || value === undefined
    ? { spans, diagnostics }
    : { value, spans, diagnostics }
}
