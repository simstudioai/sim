/**
 * MCP servers the workspace consumes: `mcp/<key>.ts` declares one server's URL, headers and
 * connection settings. A workflow names the server as `mcp('<key>')` and one of its tools as
 * `mcp('<key>').tool('<name>')`.
 *
 * ```ts
 * // @sim-sdk 1
 * import { defineMcpServer, env, stored } from '@sim/workflow-sdk/workspace'
 *
 * export default defineMcpServer({
 *   name: 'GitHub',
 *   url: 'https://api.githubcopilot.com/mcp/',
 *   headers: { Authorization: 'Bearer {{GITHUB_TOKEN}}', 'X-Api-Key': env.GITHUB_KEY },
 * })
 * ```
 *
 * A header value is stored as text in which `{{NAME}}` names an environment variable the server
 * resolves when it connects; `env.NAME` is that text for a whole value. Secrets never sit in
 * source: a credential header ({@link isCredentialHeader}) holding literal text beyond an auth
 * scheme is `E_MCP_LITERAL_SECRET`, and a get prints such a stored value as `stored()` ("keep the
 * value the server holds"). The server resolves `stored()` to a keyed hash of the value it holds,
 * so the fingerprint follows the value without the value or a plain hash of it leaving the server.
 * An OAuth client secret is set in the server's settings, never in source.
 */
import { compareStrings } from '@sim/utils/string'
import { holdsSecret, type Json, withoutAuthScheme } from '@sim/workflow-code'
import {
  asDeclared,
  booleanField,
  canonicalFields,
  type DeclField,
  type DeclFields,
  printFields,
  readFields,
  stringField,
} from '../declaration/field-table'
import {
  checkKnownFields,
  fieldPointer,
  fieldReporter,
  isOneOf,
  readObject,
  readStringField,
} from '../declaration/fields'
import { call, envRef, printDeclaration } from '../declaration/print'
import {
  isDeclarationCall,
  isDeclarationEnvRef,
  readDeclaration,
  unstorableCharacter,
} from '../declaration/read'
import { diagnostic, resourceOf, type WorkspaceDiagnostic, wholeFile } from '../diagnostics'
import { KIND_DIRS, type KindCodec } from '../kind'
import { DECLARATION_EXTENSION } from '../layout'
import { groupByFile } from './group'

/** Transports a server is reached over. Mirrors `McpTransport` (apps/sim/lib/mcp/types). */
const MCP_TRANSPORTS = ['streamable-http'] as const
/** How a server authenticates. Mirrors `McpAuthType` (apps/sim/lib/mcp/types). */
export const MCP_AUTH_TYPES = ['none', 'headers', 'oauth'] as const

/**
 * The settings a server gets when none are declared. Mirrors the defaults
 * `createMcpServer` (apps/sim/lib/mcp/orchestration/server-lifecycle) stores, so an undeclared
 * and a spelled-out default fingerprint alike.
 */
export const MCP_DEFAULTS = {
  transport: 'streamable-http',
  auth: 'headers',
  timeout: 30_000,
  retries: 3,
} as const

/**
 * A header value kept as the server stores it: `stored()` in source. `stored` is the server's
 * keyed hash of the stored value; `null` until the server resolves a declaration's `stored()`
 * against what it holds.
 */
interface McpStoredHeader {
  stored: string | null
}

/** A header value: text (`{{NAME}}` names an env variable), or the stored value kept. */
export type McpHeaderDecl = string | McpStoredHeader

/** How the server authenticates; `clientId` is a pre-registered OAuth client. */
export interface McpAuthDecl {
  type: (typeof MCP_AUTH_TYPES)[number]
  clientId?: string
}

/** An MCP server as `mcp/<key>.ts` declares it. */
export interface McpServerDecl {
  /** The display name; the key when the declaration leaves it out. */
  name: string
  description?: string
  /** The server's URL. Its id derives from it, so a changed URL replaces the server. */
  url: string
  transport?: (typeof MCP_TRANSPORTS)[number]
  headers?: Record<string, McpHeaderDecl>
  auth?: McpAuthDecl
  /** Milliseconds a request waits. */
  timeout?: number
  retries?: number
  enabled?: boolean
}

const CALLEE = 'defineMcpServer'
const STORED_CALL = 'stored'
/** A whole value that is one env reference: `{{NAME}}`. */
const WHOLE_ENV_REFERENCE = /^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/
/** An HTTP header name (RFC 9110 token). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/** A credential-bearing header name, by its words. */
const CREDENTIAL_HEADER =
  /^(authorization|proxy-authorization|cookie)$|key|token|secret|auth|password|session|signature|credential/i

/** `mcp/<key>.ts`. */
export function mcpDeclarationPath(key: string): string {
  return `${KIND_DIRS['mcp-server']}/${key}${DECLARATION_EXTENSION}`
}

/** Whether a header carries a credential by its name, so its value may hold no literal text. */
function isCredentialHeader(name: string): boolean {
  return CREDENTIAL_HEADER.test(name)
}

/**
 * Whether `value`, the value of header `name`, holds a literal secret by the predicate workflows
 * share (`holdsSecret`): a credential header is a password field, so any text past an auth scheme
 * word that is more than `{{NAME}}` references counts; any other header counts only when it holds a
 * detected credential (a known token format).
 */
export function holdsLiteralSecret(name: string, value: string): boolean {
  const credential = isCredentialHeader(name)
  return holdsSecret({ password: credential }, credential ? withoutAuthScheme(value) : value)
}

/** Whether a header value is a kept stored value. */
export function isStoredHeader(value: McpHeaderDecl): value is McpStoredHeader {
  return typeof value !== 'string'
}

/** A whole number at least `min`, fingerprinted as declared or `fallback`. */
function wholeNumberField(min: number, fallback: number): DeclField<number | undefined> {
  return {
    read(value, field, pointer, report) {
      const raw = value[field]
      if (raw === undefined) return undefined
      if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min) {
        report(
          'E_DECL_SHAPE',
          fieldPointer(pointer, field),
          `"${field}" must be a whole number of at least ${min}.`
        )
        return undefined
      }
      return raw
    },
    print: asDeclared,
    canonical: (number) => number ?? fallback,
  }
}

const urlField: DeclField<string | undefined> = {
  read(value, field, pointer, report) {
    const url = readStringField(value, field, pointer, report, { required: true })
    if (url !== undefined && !/^https?:\/\//i.test(url)) {
      report('E_DECL_SHAPE', fieldPointer(pointer, field), '"url" is an http:// or https:// URL.')
      return undefined
    }
    return url
  },
  print: asDeclared,
  canonical: asDeclared,
}

const transportField: DeclField<McpServerDecl['transport']> = {
  read(value, field, pointer, report) {
    const raw = readStringField(value, field, pointer, report)
    if (raw === undefined || isOneOf(MCP_TRANSPORTS, raw)) return raw
    report(
      'E_DECL_SHAPE',
      fieldPointer(pointer, field),
      `"transport" is one of ${MCP_TRANSPORTS.join(', ')}.`
    )
    return undefined
  },
  print: asDeclared,
  canonical: (transport) => transport ?? MCP_DEFAULTS.transport,
}

/** One header value read from source, or `undefined` (reported) when it is refused. */
function readHeaderValue(
  name: string,
  raw: Json,
  at: string,
  report: Parameters<DeclField<unknown>['read']>[3]
): McpHeaderDecl | undefined {
  if (isDeclarationEnvRef(raw)) return `{{${raw.$env}}}`
  if (isDeclarationCall(raw) && raw.$call === STORED_CALL && raw.args.length === 0) {
    return { stored: null }
  }
  if (typeof raw !== 'string') {
    report('E_DECL_SHAPE', at, `Header "${name}" is text, \`env.NAME\` or \`stored()\`.`)
    return undefined
  }
  const problem = unstorableCharacter(raw) ?? (/[\r\n]/.test(raw) ? 'a line break' : null)
  if (problem) {
    report('E_DECL_SHAPE', at, `Header "${name}" holds ${problem}.`)
    return undefined
  }
  if (holdsLiteralSecret(name, raw)) {
    report(
      'E_MCP_LITERAL_SECRET',
      at,
      `Header "${name}" holds a literal secret; secrets never sit in source.`,
      `Store it as an env variable and write \`'${name}': env.NAME\` (or \`'Bearer {{NAME}}'\`), or \`stored()\` to keep the value the server holds.`
    )
    return undefined
  }
  return raw
}

const headersField: DeclField<McpServerDecl['headers']> = {
  read(value, field, pointer, report) {
    if (value[field] === undefined) return undefined
    const at = fieldPointer(pointer, field)
    const object = readObject(value[field], at, report, field)
    if (!object) return undefined
    const headers: Record<string, McpHeaderDecl> = {}
    const seen = new Map<string, string>()
    let ok = true
    for (const [name, raw] of Object.entries(object)) {
      const headerAt = fieldPointer(at, name)
      const folded = name.toLowerCase()
      if (!HEADER_NAME.test(name)) {
        report('E_DECL_SHAPE', headerAt, `"${name}" is not a header name.`)
        ok = false
        continue
      }
      const earlier = seen.get(folded)
      if (earlier !== undefined) {
        report('E_DECL_SHAPE', headerAt, `"${name}" and "${earlier}" name one header.`)
        ok = false
        continue
      }
      seen.set(folded, name)
      const header = readHeaderValue(name, raw, headerAt, report)
      if (header === undefined) ok = false
      else headers[name] = header
    }
    return ok ? headers : undefined
  },
  print: (headers) =>
    headers === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(headers).map(([name, header]) => {
            if (isStoredHeader(header)) return [name, call(STORED_CALL)]
            const env = WHOLE_ENV_REFERENCE.exec(header)
            return [name, env ? envRef(env[1]) : header]
          })
        ),
  canonical: (headers) =>
    Object.fromEntries(
      Object.entries(headers ?? {})
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([name, header]) => [
          name,
          isStoredHeader(header) ? { stored: header.stored } : header,
        ])
    ),
}

const AUTH_FIELDS = ['type', 'clientId'] as const

const authField: DeclField<McpAuthDecl | undefined> = {
  read(value, field, pointer, report) {
    if (value[field] === undefined) return undefined
    const at = fieldPointer(pointer, field)
    const object = readObject(value[field], at, report, field)
    if (!object) return undefined
    checkKnownFields(object, AUTH_FIELDS, at, report)
    const type = readStringField(object, 'type', at, report, { required: true })
    const clientId = readStringField(object, 'clientId', at, report, { required: false })
    if (type === undefined) return undefined
    if (!isOneOf(MCP_AUTH_TYPES, type)) {
      report(
        'E_DECL_SHAPE',
        fieldPointer(at, 'type'),
        `"type" is one of ${MCP_AUTH_TYPES.join(', ')}.`
      )
      return undefined
    }
    if (clientId !== undefined && type !== 'oauth') {
      report('E_DECL_SHAPE', fieldPointer(at, 'clientId'), '"clientId" is for `type: \'oauth\'`.')
      return undefined
    }
    return clientId === undefined ? { type } : { type, clientId }
  },
  print: (auth) =>
    auth === undefined
      ? undefined
      : { type: auth.type, ...(auth.clientId !== undefined ? { clientId: auth.clientId } : {}) },
  canonical: (auth) => ({
    type: auth?.type ?? MCP_DEFAULTS.auth,
    clientId: auth?.clientId ?? null,
  }),
}

/** The fields of `mcp/<key>.ts`, in print order. */
const MCP_FIELDS: DeclFields<McpServerDecl> = {
  name: stringField({ name: true }),
  description: stringField({}, (description) => description || null),
  url: urlField,
  transport: transportField,
  headers: headersField,
  auth: authField,
  timeout: wholeNumberField(1, MCP_DEFAULTS.timeout),
  retries: wholeNumberField(0, MCP_DEFAULTS.retries),
  enabled: booleanField((enabled) => enabled !== false),
}

function parseMcpServer(
  key: string,
  text: Readonly<Record<string, string>>
): { decl?: McpServerDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = mcpDeclarationPath(key)
  const resource = resourceOf('mcp-server', key)
  const source = text[file]
  if (source === undefined) {
    return {
      diagnostics: [
        diagnostic('E_DECL_SHAPE', `${file} is missing.`, { ...resource, span: wholeFile(file) }),
      ],
    }
  }
  const read = readDeclaration(file, source, {
    callee: CALLEE,
    calls: new Set([STORED_CALL]),
    env: true,
  })
  const diagnostics = read.diagnostics.map((finding) => ({ ...finding, ...resource }))
  if (read.value === undefined) return { diagnostics }
  const report = fieldReporter(source, read.spans, diagnostics, resource)
  const value = readObject(read.value, '', report, `${CALLEE}()`)
  if (!value) return { diagnostics }
  const { name, url, ...fields } = readFields(MCP_FIELDS, value, '', report)
  if (diagnostics.some((finding) => finding.severity === 'error') || url === undefined) {
    return { diagnostics }
  }
  return { decl: { name: name || key, url, ...fields }, diagnostics }
}

/** Reads and prints `mcp/<key>.ts`. */
export const mcpCodec: KindCodec<McpServerDecl> = {
  group: (paths) => groupByFile(KIND_DIRS['mcp-server'], [DECLARATION_EXTENSION], paths),
  parse: (key, text) => parseMcpServer(key, text),
  print: (key, decl) => ({
    text: { [mcpDeclarationPath(key)]: printDeclaration(CALLEE, printFields(MCP_FIELDS, decl)) },
    blobs: [],
  }),
  canonical: (decl) => canonicalFields(MCP_FIELDS, decl),
}
