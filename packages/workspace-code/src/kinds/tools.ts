/**
 * Custom tools: `tools/<key>.ts` declares a tool's title and function schema, and its code lives
 * beside it in `tools/<key>.js`.
 *
 * ```ts
 * // @sim-sdk 1
 * import { codeFile, defineTool } from '@sim/workflow-sdk/workspace'
 *
 * export default defineTool({
 *   title: 'Lookup order',
 *   schema: {
 *     type: 'function',
 *     function: { name: 'lookup_order', parameters: { type: 'object', properties: {} } },
 *   },
 *   code: codeFile('./lookup-order.js'),
 * })
 * ```
 *
 * The schema is stored and printed verbatim. The code file is the stored code in the workflow
 * code-file form (`{{API_KEY}}` reads as `$env.API_KEY`, so it stays a name, never a value). A
 * tool runs outside any workflow, so `$ref.<block>` has nothing to name and a code file holding one
 * is refused. Code that form cannot hold exactly (it does not parse, already names `$env`, or holds
 * a `<block.output>` token) prints inline as a string, so every stored tool reads back unchanged.
 *
 * Code holding what looks like a literal credential (the detection function code uses,
 * `holdsSecret`) never lands in source: a get prints it as `code: stored()`, which keeps the code
 * the server holds, with `W_TOOL_LITERAL_SECRET`; code written with one applies with the same
 * warning.
 */
import { checkCodeFileBijection, fromCodeFile, holdsSecret, type Json } from '@sim/workflow-code'
import {
  asDeclared,
  canonicalFields,
  type DeclField,
  type DeclFields,
  printFields,
  readFields,
  stringField,
} from '../declaration/field-table'
import { fieldPointer, fieldReporter, readObject } from '../declaration/fields'
import { call, printDeclaration } from '../declaration/print'
import { isDeclarationCall, readDeclaration, unstorableCharacter } from '../declaration/read'
import {
  diagnostic,
  resourceOf,
  sourceLocator,
  type WorkspaceDiagnostic,
  wholeFile,
} from '../diagnostics'
import { KIND_DIRS, type KindCodec } from '../kind'
import { DECLARATION_EXTENSION } from '../layout'
import { groupByFile } from './group'

/** A custom tool as `tools/<key>.ts` (and its code file) declares it. */
export interface ToolDecl {
  title: string
  /** The function declaration as stored: `{ type: 'function', function: { name, parameters } }`. */
  schema: Record<string, Json>
  /** The stored code, references as their stored tokens (`{{NAME}}`, `<block.field>`). */
  code: ToolCode
}

/**
 * The code kept as the server holds it: `stored()` in source. `stored` is the server's keyed hash
 * of the stored code, `null` until the server resolves a declaration's `stored()` against it.
 */
interface StoredToolCode {
  stored: string | null
}

/** A tool's code: the text, or the stored code kept. */
export type ToolCode = string | StoredToolCode

/** Whether `code` keeps the stored code. */
export function isStoredToolCode(code: ToolCode): code is StoredToolCode {
  return typeof code !== 'string'
}

/** The message and hint of `W_TOOL_LITERAL_SECRET`, for a get that printed `stored()` or code a directory holds. */
export function toolLiteralSecret(printedStored: boolean): { message: string; hint: string } {
  return {
    message: printedStored
      ? 'The code holds what looks like a literal credential; get prints it as stored() so it never lands in a file.'
      : 'The code holds what looks like a literal credential, which travels with every copy of the directory.',
    hint: 'Store the credential as a workspace secret and read it as $env.NAME in the code, so the key never sits in the tool.',
  }
}

const CALLEE = 'defineTool'
const CODE_FILE_CALL = 'codeFile'
const STORED_CALL = 'stored'
/** The field the codec reads, prints and fingerprints itself: it may name the tool's code file. */
const CODE_FIELD = 'code' satisfies keyof ToolDecl
const CODE_EXTENSION = '.js'

/** Whether `value` holds a helper call anywhere: a schema is plain JSON. */
function holdsCall(value: Json): boolean {
  if (isDeclarationCall(value)) return true
  if (Array.isArray(value)) return value.some(holdsCall)
  return value !== null && typeof value === 'object' && Object.values(value).some(holdsCall)
}

/** The required function schema: a plain JSON object, stored and printed verbatim. */
const schemaField: DeclField<Record<string, Json> | undefined> = {
  read(value, field, pointer, report) {
    if (value[field] === undefined) {
      report('E_DECL_SHAPE', pointer, `"${field}" is required.`)
      return undefined
    }
    const at = fieldPointer(pointer, field)
    const schema = readObject(value[field], at, report, field)
    if (schema && holdsCall(schema)) {
      report('E_TOOL_SCHEMA', at, 'The schema holds JSON values only.')
      return undefined
    }
    return schema
  },
  print: asDeclared,
  canonical: asDeclared,
}

/**
 * The fields of `defineTool()` besides {@link CODE_FIELD}, in print order, each fingerprinted as
 * declared.
 */
const TOOL_FIELDS: DeclFields<Omit<ToolDecl, typeof CODE_FIELD>> = {
  title: stringField({ required: true, name: true }),
  schema: schemaField,
}

/** `tools/<key>.ts`. */
export function toolDeclarationPath(key: string): string {
  return `${KIND_DIRS['custom-tool']}/${key}${DECLARATION_EXTENSION}`
}

/** `tools/<key>.js`. */
function codePath(key: string): string {
  return `${KIND_DIRS['custom-tool']}/${key}${CODE_EXTENSION}`
}

/** Stored code as its code file, when the file reads back as exactly that code with no `$ref`. */
function codeFileOf(code: string): string | undefined {
  const file = checkCodeFileBijection(code, 'javascript')
  if (!file.ok) return undefined
  const read = fromCodeFile(file.file, 'javascript')
  return read.ok && read.refs.every((ref) => ref.kind !== 'ref') ? file.file : undefined
}

/** Reads `tools/<key>.js` back into stored code, reporting where it fails. */
function readCodeFile(
  key: string,
  text: Readonly<Record<string, string>>,
  diagnostics: WorkspaceDiagnostic[]
): string | undefined {
  const file = codePath(key)
  const source = text[file]
  const resource = resourceOf('custom-tool', key)
  if (source === undefined) {
    diagnostics.push(
      diagnostic('E_TOOL_CODE', `${file} is missing.`, {
        ...resource,
        span: wholeFile(toolDeclarationPath(key)),
        hint: `Write the tool's code in ${file}.`,
      })
    )
    return undefined
  }
  const read = fromCodeFile(source, 'javascript')
  const at = sourceLocator(file, source)
  if (!read.ok) {
    for (const error of read.errors) {
      diagnostics.push(
        diagnostic('E_TOOL_CODE', error.message, {
          ...resource,
          ...at.located(at.span(error.start, error.start + 1)),
        })
      )
    }
    return undefined
  }
  const workflowRefs = read.refs.filter((ref) => ref.kind === 'ref')
  for (const ref of workflowRefs) {
    diagnostics.push(
      diagnostic(
        'E_TOOL_CODE',
        'A custom tool runs outside any workflow, so `$ref` has nothing to name.',
        {
          ...resource,
          ...at.located(at.span(ref.start, ref.end)),
          hint: "Read values from the tool's parameters, or a secret with `$env.NAME`.",
        }
      )
    )
  }
  if (workflowRefs.length > 0) return undefined
  const problem = unstorableCharacter(read.code)
  if (problem) {
    diagnostics.push(
      diagnostic('E_TOOL_CODE', `The code holds ${problem}, which cannot be stored.`, {
        ...resource,
        span: wholeFile(file),
      })
    )
    return undefined
  }
  return read.code
}

function parseTool(
  key: string,
  text: Readonly<Record<string, string>>
): { decl?: ToolDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = toolDeclarationPath(key)
  const resource = resourceOf('custom-tool', key)
  const source = text[file]
  if (source === undefined) {
    return {
      diagnostics: [
        diagnostic('E_DECL_UNKNOWN_FILE', `${codePath(key)} has no declaration ${file}.`, {
          ...resource,
          span: wholeFile(codePath(key)),
          hint: `Declare the tool in ${file}, or remove ${codePath(key)}.`,
        }),
      ],
    }
  }
  const read = readDeclaration(file, source, {
    callee: CALLEE,
    calls: new Set([CODE_FILE_CALL, STORED_CALL]),
  })
  const diagnostics = read.diagnostics.map((finding) => ({ ...finding, ...resource }))
  if (read.value === undefined) return { diagnostics }
  const report = fieldReporter(source, read.spans, diagnostics, resource)
  const value = readObject(read.value, '', report, `${CALLEE}()`)
  if (!value) return { diagnostics }
  const { title, schema } = readFields(TOOL_FIELDS, value, '', report, [CODE_FIELD])
  let code: ToolCode | undefined
  const rawCode = value[CODE_FIELD]
  const expected = `./${key}${CODE_EXTENSION}`
  if (rawCode === undefined) report('E_DECL_SHAPE', '', '"code" is required.')
  else if (typeof rawCode === 'string') {
    code = rawCode
    if (text[codePath(key)] !== undefined) {
      report(
        'E_TOOL_CODE',
        '/code',
        `The code is inline, so ${codePath(key)} is unused.`,
        `Write \`code: codeFile('${expected}')\`, or remove ${codePath(key)}.`
      )
    }
  } else if (
    isDeclarationCall(rawCode) &&
    rawCode.$call === CODE_FILE_CALL &&
    rawCode.args.length === 1 &&
    rawCode.args[0] === expected
  ) {
    code = readCodeFile(key, text, diagnostics)
  } else if (
    isDeclarationCall(rawCode) &&
    rawCode.$call === STORED_CALL &&
    rawCode.args.length === 0
  ) {
    code = { stored: null }
    if (text[codePath(key)] !== undefined) {
      report(
        'E_TOOL_CODE',
        '/code',
        `The code is \`stored()\`, so ${codePath(key)} is unused.`,
        `Write \`code: codeFile('${expected}')\`, or remove ${codePath(key)}.`
      )
    }
  } else {
    report(
      'E_TOOL_CODE',
      '/code',
      `The code is \`codeFile('${expected}')\`, a string or \`stored()\`.`,
      `A tool's code file is named after its key: ${codePath(key)}.`
    )
  }
  if (typeof code === 'string' && holdsSecret(undefined, code)) {
    const { message, hint } = toolLiteralSecret(false)
    report('W_TOOL_LITERAL_SECRET', '/code', message, hint)
  }
  if (
    diagnostics.some((finding) => finding.severity === 'error') ||
    title === undefined ||
    schema === undefined ||
    code === undefined
  ) {
    return { diagnostics }
  }
  return { decl: { title, schema, code }, diagnostics }
}

/** Reads and prints `tools/<key>.ts` and `tools/<key>.js`. */
export const toolCodec: KindCodec<ToolDecl> = {
  group: (paths) =>
    groupByFile(KIND_DIRS['custom-tool'], [DECLARATION_EXTENSION, CODE_EXTENSION], paths),
  parse: (key, text) => parseTool(key, text),
  print(key, decl) {
    const code = decl.code
    const file = isStoredToolCode(code) ? undefined : codeFileOf(code)
    const value: Record<string, Json> = {
      ...printFields(TOOL_FIELDS, decl),
      [CODE_FIELD]: isStoredToolCode(code)
        ? call(STORED_CALL)
        : file === undefined
          ? code
          : call(CODE_FILE_CALL, `./${key}${CODE_EXTENSION}`),
    }
    return {
      text: {
        [toolDeclarationPath(key)]: printDeclaration(CALLEE, value),
        ...(file === undefined ? {} : { [codePath(key)]: file }),
      },
      blobs: [],
    }
  },
  canonical: (decl) => ({
    ...canonicalFields(TOOL_FIELDS, decl),
    [CODE_FIELD]: isStoredToolCode(decl.code) ? { stored: decl.code.stored } : decl.code,
  }),
}
