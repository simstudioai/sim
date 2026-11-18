/**
 * Deployments: `deployments/<key>.ts` deploys the workflow `workflows/<key>/`, so its schedule,
 * webhook, API and chat triggers run, and states whether the draft goes live (`live`), whether
 * its API is public, and the chat it serves.
 *
 * ```ts
 * // @sim-sdk 1
 * import { defineDeployment, env } from '@sim/workflow-sdk/workspace'
 *
 * export default defineDeployment({
 *   live: 'draft',
 *   api: { public: false },
 *   chat: {
 *     identifier: 'support',
 *     title: 'Support',
 *     auth: { password: env.SUPPORT_CHAT_PASSWORD },
 *     outputs: [{ block: 'Answer', path: 'content' }],
 *   },
 * })
 * ```
 *
 * A deployment is a folder of its own, not part of `workflows/<key>/`, because deploying needs a
 * workspace admin (and never a workspace API key) while editing a workflow needs write, and a
 * workflow folder stays exactly a single-workflow source directory. The chat password is never a
 * value: `env.NAME` sets it from that variable, `stored()` keeps the stored one. A chat output
 * names its block by name; the server translates it to the block's id.
 */
import type { Json } from '@sim/workflow-code'
import {
  asDeclared,
  booleanField,
  canonicalFields,
  type DeclField,
  type DeclFields,
  objectField,
  printFields,
  readFields,
  stringField,
} from '../declaration/field-table'
import {
  checkKnownFields,
  type FieldReport,
  fieldPointer,
  fieldReporter,
  isOneOf,
  readObject,
} from '../declaration/fields'
import { call, envRef, printDeclaration } from '../declaration/print'
import { isDeclarationCall, isDeclarationEnvRef, readDeclaration } from '../declaration/read'
import { resourceOf, type WorkspaceDiagnostic } from '../diagnostics'
import { KIND_DIRS, type KindCodec } from '../kind'
import { DECLARATION_EXTENSION } from '../layout'
import { groupByFile } from './group'

/** Whether an apply publishes the draft whenever it differs from the live version. */
const DEPLOYMENT_LIVE_MODES = ['draft', 'pinned'] as const

/** A chat password: an environment variable by name, or the password the chat already stores. */
type ChatSecretDecl = { env: string } | 'stored'

/** Who may open a chat: anyone, a password holder, or the listed emails (by code or by SSO). */
export type ChatAuthDecl =
  | 'public'
  | { password: ChatSecretDecl }
  | { emails: string[] }
  | { sso: string[] }

/** One output a chat answers with: a block by name, and the path of its output. */
interface ChatOutputDecl {
  block: string
  path: string
}

/** A chat's look; an undeclared field takes the platform default. */
export interface ChatCustomizationsDecl {
  primaryColor?: string
  welcomeMessage?: string
  imageUrl?: string
}

/** The chat a deployment serves. */
export interface ChatDecl {
  /** The chat's public URL path segment, unique across the platform. */
  identifier: string
  title: string
  description?: string
  auth: ChatAuthDecl
  outputs?: ChatOutputDecl[]
  customizations?: ChatCustomizationsDecl
  includeThinking?: boolean
  includeToolCalls?: boolean
}

/** A deployment as `deployments/<key>.ts` declares it. */
export interface DeploymentDecl {
  live: (typeof DEPLOYMENT_LIVE_MODES)[number]
  api?: { public?: boolean }
  chat?: ChatDecl
}

/**
 * A chat's look when it declares none. Mirrors the replace defaults of the chat deployment use
 * case (apps/sim/lib/chat-deployments), which an apps/sim test holds this equal to.
 */
export const CHAT_DEFAULT_CUSTOMIZATIONS = {
  primaryColor: 'var(--brand-hover)',
  welcomeMessage: 'Hi there! How can I help you today?',
} as const

const CALLEE = 'defineDeployment'
const STORED_CALL = 'stored'

/** `deployments/<key>.ts`. */
export function deploymentDeclarationPath(key: string): string {
  return `${KIND_DIRS.deployment}/${key}${DECLARATION_EXTENSION}`
}

/** The secret a password reads from, as the plan and the fingerprint name it. */
function canonicalSecret(secret: ChatSecretDecl): Json {
  return secret === 'stored' ? 'stored' : { env: secret.env }
}

function readSecret(raw: Json, pointer: string, report: FieldReport) {
  if (isDeclarationEnvRef(raw)) return { env: raw.$env }
  if (isDeclarationCall(raw) && raw.$call === STORED_CALL && raw.args.length === 0) return 'stored'
  report(
    'E_DEPLOY_SECRET',
    pointer,
    typeof raw === 'string'
      ? 'A chat password is never written in source.'
      : 'A chat password is `env.NAME` or `stored()`.',
    'Set it as a secret and write `env.NAME`, or `stored()` to keep the stored password.'
  )
  return undefined
}

/** A list of non-empty strings (an email allow-list). */
function readStrings(
  raw: Json,
  pointer: string,
  field: string,
  report: FieldReport
): string[] | undefined {
  if (Array.isArray(raw)) {
    const strings = raw.filter((item): item is string => typeof item === 'string' && item !== '')
    if (strings.length === raw.length) return strings
  }
  report('E_DECL_SHAPE', pointer, `"${field}" must be a list of non-empty strings.`)
  return undefined
}

const AUTH_MODES = ['password', 'emails', 'sso'] as const

const authField: DeclField<ChatAuthDecl | undefined> = {
  read(value, field, pointer, report) {
    const raw = value[field]
    const at = fieldPointer(pointer, field)
    if (raw === undefined) {
      report('E_DECL_SHAPE', pointer, `"${field}" is required.`)
      return undefined
    }
    if (raw === 'public') return 'public'
    const object = readObject(raw, at, report, field)
    if (!object) return undefined
    const modes = Object.keys(object)
    const mode = modes[0]
    if (modes.length !== 1 || mode === undefined || !isOneOf(AUTH_MODES, mode)) {
      report(
        'E_DECL_SHAPE',
        at,
        `"${field}" is 'public', { password }, { emails } or { sso }.`,
        "Write `auth: 'public'`, `auth: { password: env.NAME }` or `auth: { emails: ['a@b.co'] }`."
      )
      return undefined
    }
    const modeAt = fieldPointer(at, mode)
    if (mode === 'password') {
      const secret = readSecret(object.password, modeAt, report)
      return secret && { password: secret }
    }
    const emails = readStrings(object[mode], modeAt, mode, report)
    if (!emails) return undefined
    return mode === 'emails' ? { emails } : { sso: emails }
  },
  print(auth): Json | undefined {
    if (auth === undefined || auth === 'public') return auth
    if ('password' in auth) {
      const { password } = auth
      return { password: password === 'stored' ? call(STORED_CALL) : envRef(password.env) }
    }
    return 'emails' in auth ? { emails: auth.emails } : { sso: auth.sso }
  },
  canonical(auth): Json {
    if (auth === undefined || auth === 'public') return { type: 'public' }
    if ('password' in auth) return { type: 'password', password: canonicalSecret(auth.password) }
    return 'emails' in auth
      ? { type: 'email', emails: auth.emails }
      : { type: 'sso', emails: auth.sso }
  },
}

const outputsField: DeclField<ChatOutputDecl[] | undefined> = {
  read(value, field, pointer, report) {
    const raw = value[field]
    if (raw === undefined) return undefined
    const at = fieldPointer(pointer, field)
    if (!Array.isArray(raw)) {
      report('E_DECL_SHAPE', at, `"${field}" must be a list of { block, path }.`)
      return undefined
    }
    const outputs: ChatOutputDecl[] = []
    raw.forEach((item, index) => {
      const itemAt = fieldPointer(at, index)
      const output = readObject(item, itemAt, report, 'An output')
      if (!output) return
      checkKnownFields(output, ['block', 'path'], itemAt, report)
      const { block, path } = output
      if (typeof block !== 'string' || block === '' || typeof path !== 'string' || path === '') {
        report('E_DECL_SHAPE', itemAt, 'An output is { block: <block name>, path: <output path> }.')
        return
      }
      outputs.push({ block, path })
    })
    return outputs.length === raw.length ? outputs : undefined
  },
  print: (outputs) => outputs?.map((output) => ({ block: output.block, path: output.path })),
  canonical: (outputs) => (outputs ?? []).map((output) => ({ ...output })),
}

const CUSTOMIZATION_FIELDS: DeclFields<ChatCustomizationsDecl> = {
  primaryColor: stringField(),
  welcomeMessage: stringField(),
  imageUrl: stringField(),
}

/** Off when not declared. */
const flagField = booleanField((flag) => flag === true)

const CHAT_FIELDS: DeclFields<ChatDecl> = {
  identifier: stringField({ required: true }),
  title: stringField({ required: true }),
  description: stringField({}, (description) => description || null),
  auth: authField,
  outputs: outputsField,
  customizations: objectField(CUSTOMIZATION_FIELDS, (customizations) => ({
    primaryColor: customizations?.primaryColor || CHAT_DEFAULT_CUSTOMIZATIONS.primaryColor,
    welcomeMessage: customizations?.welcomeMessage || CHAT_DEFAULT_CUSTOMIZATIONS.welcomeMessage,
    imageUrl: customizations?.imageUrl || null,
  })),
  includeThinking: flagField,
  includeToolCalls: flagField,
}

const API_FIELDS: DeclFields<NonNullable<DeploymentDecl['api']>> = {
  /** Private when not declared. */
  public: booleanField((isPublic) => isPublic === true),
}

const liveField: DeclField<DeploymentDecl['live'] | undefined> = {
  read(value, field, pointer, report) {
    const raw = value[field]
    if (typeof raw === 'string' && isOneOf(DEPLOYMENT_LIVE_MODES, raw)) return raw
    report(
      'E_DECL_SHAPE',
      raw === undefined ? pointer : fieldPointer(pointer, field),
      `"${field}" is 'draft' or 'pinned'.`
    )
    return undefined
  },
  print: asDeclared,
  /**
   * Left out: `live` is what an apply does about the draft, not state the server stores. Each
   * apply reads it with the server's own "draft differs" flag, so an edit to it is never dropped.
   */
  canonical: null,
}

/** A chat, fingerprinted with its defaults filled in; no chat fingerprints as `null`. */
const chatObject = objectField(CHAT_FIELDS, (chat) =>
  chat ? canonicalFields(CHAT_FIELDS, chat) : null
)

/**
 * The fields of `defineDeployment()`. An undeclared field and its spelled-out default fingerprint
 * alike.
 */
const DEPLOYMENT_FIELDS: DeclFields<DeploymentDecl> = {
  live: liveField,
  api: objectField(API_FIELDS, (api) => canonicalFields(API_FIELDS, api ?? {})),
  chat: {
    ...chatObject,
    read(value, field, pointer, report) {
      const chat = chatObject.read(value, field, pointer, report)
      if (chat === undefined) return undefined
      const { identifier, title, auth, ...rest } = chat
      if (identifier === undefined || title === undefined || auth === undefined) return undefined
      return { identifier, title, auth, ...rest }
    },
  },
}

function parseDeployment(
  key: string,
  text: Readonly<Record<string, string>>
): { decl?: DeploymentDecl; diagnostics: WorkspaceDiagnostic[] } {
  const file = deploymentDeclarationPath(key)
  const resource = resourceOf('deployment', key)
  const source = text[file] ?? ''
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
  const { live, ...fields } = readFields(DEPLOYMENT_FIELDS, value, '', report)
  if (diagnostics.some((finding) => finding.severity === 'error') || live === undefined) {
    return { diagnostics }
  }
  return { decl: { live, ...fields }, diagnostics }
}

/** Reads and prints `deployments/<key>.ts`. */
export const deploymentCodec: KindCodec<DeploymentDecl> = {
  group: (paths) => groupByFile(KIND_DIRS.deployment, [DECLARATION_EXTENSION], paths),
  parse: (key, text) => parseDeployment(key, text),
  print: (key, decl) => ({
    text: {
      [deploymentDeclarationPath(key)]: printDeclaration(
        CALLEE,
        printFields(DEPLOYMENT_FIELDS, decl)
      ),
    },
    blobs: [],
  }),
  canonical: (decl) => canonicalFields(DEPLOYMENT_FIELDS, decl),
}
