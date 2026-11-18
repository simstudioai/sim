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
 */
import { checkCodeFileBijection, fromCodeFile, type Json } from '@sim/workflow-code'
import { asDeclared, type CanonicalFields, canonicalOf } from '../declaration/field-table'
import { checkKnownFields, fieldReporter, readObject, readStringField } from '../declaration/fields'
import { call, printDeclaration } from '../declaration/print'
import { isDeclarationCall, readDeclaration, unstorableCharacter } from '../declaration/read'
import { diagnostic, sourceLocator, type WorkspaceDiagnostic, wholeFile } from '../diagnostics'
import { KIND_DIRS, type KindCodec } from '../kind'
import { DECLARATION_EXTENSION } from '../layout'
import { groupByFile } from './group'

/** A custom tool as `tools/<key>.ts` (and its code file) declares it. */
export interface ToolDecl {
  title: string
  /** The function declaration as stored: `{ type: 'function', function: { name, parameters } }`. */
  schema: Record<string, Json>
  /** The stored code, references as their stored tokens (`{{NAME}}`, `<block.field>`). */
  code: string
}

const CALLEE = 'defineTool'
const CODE_FILE_CALL = 'codeFile'
/**
 * What each field of a tool adds to its fingerprint, all as declared; its keys are the fields
 * `defineTool()` takes.
 */
const TOOL_FIELDS: CanonicalFields<ToolDecl> = {
  title: asDeclared,
  schema: asDeclared,
  code: asDeclared,
}
const CODE_EXTENSION = '.js'

/** `tools/<key>.ts`. */
export function toolDeclarationPath(key: string): string {
  return `${KIND_DIRS['custom-tool']}/${key}${DECLARATION_EXTENSION}`
}

/** `tools/<key>.js`. */
function codePath(key: string): string {
  return `${KIND_DIRS['custom-tool']}/${key}${CODE_EXTENSION}`
}

/** Whether `value` holds a helper call anywhere: a schema is plain JSON. */
function holdsCall(value: Json): boolean {
  if (isDeclarationCall(value)) return true
  if (Array.isArray(value)) return value.some(holdsCall)
  return value !== null && typeof value === 'object' && Object.values(value).some(holdsCall)
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
  const resource = { kind: 'custom-tool', key }
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
  const resource = { kind: 'custom-tool', key }
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
    calls: new Set([CODE_FILE_CALL]),
  })
  const diagnostics = read.diagnostics.map((finding) => ({ ...finding, ...resource }))
  if (read.value === undefined) return { diagnostics }
  const report = fieldReporter(source, read.spans, diagnostics, resource)
  const value = readObject(read.value, '', report, `${CALLEE}()`)
  if (!value) return { diagnostics }
  checkKnownFields(value, Object.keys(TOOL_FIELDS), '', report)
  const title = readStringField(value, 'title', '', report, { required: true })
  let schema: Record<string, Json> | undefined
  if (value.schema === undefined) report('E_DECL_SHAPE', '', '"schema" is required.')
  else {
    schema = readObject(value.schema, '/schema', report, 'schema')
    if (schema && holdsCall(schema)) {
      report('E_TOOL_SCHEMA', '/schema', 'The schema holds JSON values only.')
      schema = undefined
    }
  }
  let code: string | undefined
  const rawCode = value.code
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
  } else {
    report(
      'E_TOOL_CODE',
      '/code',
      `The code is \`codeFile('${expected}')\` or a string.`,
      `A tool's code file is named after its key: ${codePath(key)}.`
    )
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
    const file = codeFileOf(decl.code)
    const value: Record<string, Json> = {
      title: decl.title,
      schema: decl.schema,
      code: file === undefined ? decl.code : call(CODE_FILE_CALL, `./${key}${CODE_EXTENSION}`),
    }
    return {
      text: {
        [toolDeclarationPath(key)]: printDeclaration(CALLEE, value),
        ...(file === undefined ? {} : { [codePath(key)]: file }),
      },
      blobs: [],
    }
  },
  canonical: (decl) => canonicalOf(TOOL_FIELDS, decl),
}
