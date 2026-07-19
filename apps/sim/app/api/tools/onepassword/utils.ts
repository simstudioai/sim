import dns from 'dns/promises'
import type {
  FileAttributes,
  Item,
  ItemCategory,
  ItemField,
  ItemFieldType,
  ItemFile,
  ItemOverview,
  ItemSection,
  VaultOverview,
  Website,
} from '@1password/sdk'
import { createLogger } from '@sim/logger'
import { isPrivateIp } from '@sim/security/ssrf'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import * as ipaddr from 'ipaddr.js'
import { isHosted } from '@/lib/core/config/env-flags'
import { secureFetchWithPinnedIP } from '@/lib/core/security/input-validation.server'

/** Connect-format field type strings returned by normalization. */
type ConnectFieldType =
  | 'STRING'
  | 'CONCEALED'
  | 'EMAIL'
  | 'URL'
  | 'OTP'
  | 'PHONE'
  | 'DATE'
  | 'MONTH_YEAR'
  | 'MENU'
  | 'ADDRESS'
  | 'REFERENCE'
  | 'SSHKEY'
  | 'CREDIT_CARD_NUMBER'
  | 'CREDIT_CARD_TYPE'

/** Connect-format category strings returned by normalization. */
type ConnectCategory =
  | 'LOGIN'
  | 'PASSWORD'
  | 'API_CREDENTIAL'
  | 'SECURE_NOTE'
  | 'SERVER'
  | 'DATABASE'
  | 'CREDIT_CARD'
  | 'IDENTITY'
  | 'SSH_KEY'
  | 'DOCUMENT'
  | 'SOFTWARE_LICENSE'
  | 'EMAIL_ACCOUNT'
  | 'MEMBERSHIP'
  | 'PASSPORT'
  | 'REWARD_PROGRAM'
  | 'DRIVER_LICENSE'
  | 'BANK_ACCOUNT'
  | 'MEDICAL_RECORD'
  | 'OUTDOOR_LICENSE'
  | 'WIRELESS_ROUTER'
  | 'SOCIAL_SECURITY_NUMBER'
  | 'CUSTOM'

/** Normalized vault shape matching the Connect API response. */
export interface NormalizedVault {
  id: string
  name: string
  description: null
  attributeVersion: number
  contentVersion: number
  items: number
  type: string
  createdAt: string | null
  updatedAt: string | null
}

/** Normalized item overview shape matching the Connect API response. */
export interface NormalizedItemOverview {
  id: string
  title: string
  vault: { id: string }
  category: ConnectCategory
  urls: Array<{ href: string; label: string | null; primary: boolean }>
  favorite: boolean
  tags: string[]
  version: number
  state: string | null
  createdAt: string | null
  updatedAt: string | null
  lastEditedBy: null
}

/** Normalized field shape matching the Connect API response. */
interface NormalizedField {
  id: string
  label: string
  type: ConnectFieldType
  purpose: string
  value: string | null
  section: { id: string } | null
  generate: boolean
  recipe: null
  entropy: null
}

/** Normalized attached-file metadata shape matching the Connect API response. */
export interface NormalizedItemFile {
  id: string
  name: string
  size: number
  section: { id: string } | null
}

/** Normalized full item shape matching the Connect API response. */
export interface NormalizedItem extends NormalizedItemOverview {
  fields: NormalizedField[]
  sections: Array<{ id: string; label: string }>
  files: NormalizedItemFile[]
}

/**
 * SDK field type string values → Connect field type mapping.
 * Uses string literals instead of enum imports to avoid loading the WASM module at build time.
 */
const SDK_TO_CONNECT_FIELD_TYPE: Record<string, ConnectFieldType> = {
  Text: 'STRING',
  Concealed: 'CONCEALED',
  Email: 'EMAIL',
  Url: 'URL',
  Totp: 'OTP',
  Phone: 'PHONE',
  Date: 'DATE',
  MonthYear: 'MONTH_YEAR',
  Menu: 'MENU',
  Address: 'ADDRESS',
  Reference: 'REFERENCE',
  SshKey: 'SSHKEY',
  CreditCardNumber: 'CREDIT_CARD_NUMBER',
  CreditCardType: 'CREDIT_CARD_TYPE',
}

/** SDK category string values → Connect category mapping. */
const SDK_TO_CONNECT_CATEGORY: Record<string, ConnectCategory> = {
  Login: 'LOGIN',
  Password: 'PASSWORD',
  ApiCredentials: 'API_CREDENTIAL',
  SecureNote: 'SECURE_NOTE',
  Server: 'SERVER',
  Database: 'DATABASE',
  CreditCard: 'CREDIT_CARD',
  Identity: 'IDENTITY',
  SshKey: 'SSH_KEY',
  Document: 'DOCUMENT',
  SoftwareLicense: 'SOFTWARE_LICENSE',
  Email: 'EMAIL_ACCOUNT',
  Membership: 'MEMBERSHIP',
  Passport: 'PASSPORT',
  Rewards: 'REWARD_PROGRAM',
  DriverLicense: 'DRIVER_LICENSE',
  BankAccount: 'BANK_ACCOUNT',
  MedicalRecord: 'MEDICAL_RECORD',
  OutdoorLicense: 'OUTDOOR_LICENSE',
  Router: 'WIRELESS_ROUTER',
  SocialSecurityNumber: 'SOCIAL_SECURITY_NUMBER',
  CryptoWallet: 'CUSTOM',
  Person: 'CUSTOM',
  Unsupported: 'CUSTOM',
}

/** Connect category → SDK category string mapping. */
const CONNECT_TO_SDK_CATEGORY: Record<string, `${ItemCategory}`> = {
  LOGIN: 'Login',
  PASSWORD: 'Password',
  API_CREDENTIAL: 'ApiCredentials',
  SECURE_NOTE: 'SecureNote',
  SERVER: 'Server',
  DATABASE: 'Database',
  CREDIT_CARD: 'CreditCard',
  IDENTITY: 'Identity',
  SSH_KEY: 'SshKey',
  DOCUMENT: 'Document',
  SOFTWARE_LICENSE: 'SoftwareLicense',
  EMAIL_ACCOUNT: 'Email',
  MEMBERSHIP: 'Membership',
  PASSPORT: 'Passport',
  REWARD_PROGRAM: 'Rewards',
  DRIVER_LICENSE: 'DriverLicense',
  BANK_ACCOUNT: 'BankAccount',
  MEDICAL_RECORD: 'MedicalRecord',
  OUTDOOR_LICENSE: 'OutdoorLicense',
  WIRELESS_ROUTER: 'Router',
  SOCIAL_SECURITY_NUMBER: 'SocialSecurityNumber',
}

/** Connect field type → SDK field type string mapping. */
const CONNECT_TO_SDK_FIELD_TYPE: Record<string, `${ItemFieldType}`> = {
  STRING: 'Text',
  CONCEALED: 'Concealed',
  EMAIL: 'Email',
  URL: 'Url',
  OTP: 'Totp',
  TOTP: 'Totp',
  PHONE: 'Phone',
  DATE: 'Date',
  MONTH_YEAR: 'MonthYear',
  MENU: 'Menu',
  ADDRESS: 'Address',
  REFERENCE: 'Reference',
  SSHKEY: 'SshKey',
  CREDIT_CARD_NUMBER: 'CreditCardNumber',
  CREDIT_CARD_TYPE: 'CreditCardType',
}

export type ConnectionMode = 'service_account' | 'connect'

export interface CredentialParams {
  connectionMode?: ConnectionMode | null
  serviceAccountToken?: string | null
  serverUrl?: string | null
  apiKey?: string | null
}

export interface ResolvedCredentials {
  mode: ConnectionMode
  serviceAccountToken?: string
  serverUrl?: string
  apiKey?: string
}

/** Determine which backend to use based on provided credentials. */
export function resolveCredentials(params: CredentialParams): ResolvedCredentials {
  const mode = params.connectionMode ?? (params.serviceAccountToken ? 'service_account' : 'connect')

  if (mode === 'service_account') {
    if (!params.serviceAccountToken) {
      throw new Error('Service Account token is required for Service Account mode')
    }
    return { mode, serviceAccountToken: params.serviceAccountToken }
  }

  if (!params.serverUrl || !params.apiKey) {
    throw new Error('Server URL and Connect token are required for Connect Server mode')
  }
  return { mode, serverUrl: params.serverUrl, apiKey: params.apiKey }
}

/**
 * Create a 1Password SDK client from a service account token.
 * Uses dynamic import to avoid loading the WASM module at build time.
 */
export async function createOnePasswordClient(serviceAccountToken: string) {
  const { createClient } = await import('@1password/sdk')
  return createClient({
    auth: serviceAccountToken,
    integrationName: 'Sim Studio',
    integrationVersion: '1.0.0',
  })
}

const connectLogger = createLogger('OnePasswordConnect')

/**
 * Enforces the SSRF policy for a resolved Connect server IP.
 *
 * On the hosted service, all private and reserved IPs are blocked — a tenant has
 * no legitimate reason to point Connect at the platform's internal network. On
 * self-hosted deployments only link-local (cloud metadata) is blocked, since the
 * operator controls both the workflows and the network and Connect servers
 * legitimately live on private (RFC1918) addresses.
 *
 * @throws Error if the IP is not permitted under the active policy.
 */
function assertConnectIpAllowed(ip: string, hostname: string): void {
  if (isHosted) {
    if (isPrivateIp(ip)) {
      connectLogger.warn('1Password Connect server URL resolves to a private or reserved IP', {
        hostname,
        resolvedIP: ip,
      })
      throw new Error('1Password server URL cannot point to a private or reserved IP address')
    }
    return
  }

  if (ipaddr.isValid(ip) && ipaddr.process(ip).range() === 'linkLocal') {
    connectLogger.warn('1Password Connect server URL resolves to a link-local IP', {
      hostname,
      resolvedIP: ip,
    })
    throw new Error('1Password server URL cannot point to a link-local address')
  }
}

/**
 * Validates a Connect server URL against the SSRF policy and returns the resolved
 * IP for DNS pinning to prevent TOCTOU rebinding. See {@link assertConnectIpAllowed}
 * for the hosted vs. self-hosted policy.
 * @throws Error if the URL is invalid, fails the IP policy, or DNS fails.
 */
export async function validateConnectServerUrl(serverUrl: string): Promise<string> {
  let hostname: string
  try {
    hostname = new URL(serverUrl).hostname
  } catch {
    throw new Error('1Password server URL is not a valid URL')
  }

  const clean =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  if (ipaddr.isValid(clean)) {
    assertConnectIpAllowed(clean, clean)
    return clean
  }

  let address: string
  try {
    ;({ address } = await dns.lookup(clean, { verbatim: true }))
  } catch (error) {
    connectLogger.warn('DNS lookup failed for 1Password Connect server URL', {
      hostname: clean,
      error: toError(error).message,
    })
    throw new Error('1Password server URL hostname could not be resolved')
  }

  assertConnectIpAllowed(address, clean)
  return address
}

/** Minimal response shape used by all connectRequest callers. */
export interface ConnectResponse {
  ok: boolean
  status: number
  statusText: string
  headers: { get: (name: string) => string | null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => Promise<any>
  text: () => Promise<string>
  arrayBuffer: () => Promise<ArrayBuffer>
}

/** Proxy a request to the 1Password Connect Server. */
export async function connectRequest(options: {
  serverUrl: string
  apiKey: string
  path: string
  method: string
  body?: unknown
  query?: string
}): Promise<ConnectResponse> {
  const resolvedIP = await validateConnectServerUrl(options.serverUrl)

  const base = options.serverUrl.replace(/\/$/, '')
  const queryStr = options.query ? `?${options.query}` : ''
  const url = `${base}${options.path}${queryStr}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  return secureFetchWithPinnedIP(url, resolvedIP, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    allowHttp: true,
  })
}

/** Normalize an SDK VaultOverview to match Connect API vault shape. */
export function normalizeSdkVault(vault: VaultOverview): NormalizedVault {
  return {
    id: vault.id,
    name: vault.title,
    description: null,
    attributeVersion: 0,
    contentVersion: 0,
    items: 0,
    type: 'USER_CREATED',
    createdAt:
      vault.createdAt instanceof Date ? vault.createdAt.toISOString() : (vault.createdAt ?? null),
    updatedAt:
      vault.updatedAt instanceof Date ? vault.updatedAt.toISOString() : (vault.updatedAt ?? null),
  }
}

/** Normalize an SDK ItemOverview to match Connect API item summary shape. */
export function normalizeSdkItemOverview(item: ItemOverview): NormalizedItemOverview {
  return {
    id: item.id,
    title: item.title,
    vault: { id: item.vaultId },
    category: SDK_TO_CONNECT_CATEGORY[item.category] ?? 'CUSTOM',
    urls: (item.websites ?? []).map((w: Website) => ({
      href: w.url,
      label: w.label ?? null,
      primary: false,
    })),
    favorite: false,
    tags: item.tags ?? [],
    version: 0,
    state: item.state === 'archived' ? 'ARCHIVED' : null,
    createdAt:
      item.createdAt instanceof Date ? item.createdAt.toISOString() : (item.createdAt ?? null),
    updatedAt:
      item.updatedAt instanceof Date ? item.updatedAt.toISOString() : (item.updatedAt ?? null),
    lastEditedBy: null,
  }
}

/** Normalize a full SDK Item to match Connect API FullItem shape. */
export function normalizeSdkItem(item: Item): NormalizedItem {
  return {
    id: item.id,
    title: item.title,
    vault: { id: item.vaultId },
    category: SDK_TO_CONNECT_CATEGORY[item.category] ?? 'CUSTOM',
    urls: (item.websites ?? []).map((w: Website) => ({
      href: w.url,
      label: w.label ?? null,
      primary: false,
    })),
    favorite: false,
    tags: item.tags ?? [],
    version: item.version ?? 0,
    state: null,
    fields: (item.fields ?? []).map((field: ItemField) => ({
      id: field.id,
      label: field.title,
      type: SDK_TO_CONNECT_FIELD_TYPE[field.fieldType] ?? 'STRING',
      purpose: '',
      value: field.value ?? null,
      section: field.sectionId ? { id: field.sectionId } : null,
      generate: false,
      recipe: null,
      entropy: null,
    })),
    sections: (item.sections ?? []).map((section: ItemSection) => ({
      id: section.id,
      label: section.title,
    })),
    files: [
      ...(item.files ?? []).map((file: ItemFile) => ({
        id: file.attributes.id,
        name: file.attributes.name,
        size: file.attributes.size,
        section: file.sectionId ? { id: file.sectionId } : null,
      })),
      ...(item.document
        ? [
            {
              id: item.document.id,
              name: item.document.name,
              size: item.document.size,
              section: null,
            },
          ]
        : []),
    ],
    createdAt:
      item.createdAt instanceof Date ? item.createdAt.toISOString() : (item.createdAt ?? null),
    updatedAt:
      item.updatedAt instanceof Date ? item.updatedAt.toISOString() : (item.updatedAt ?? null),
    lastEditedBy: null,
  }
}

/**
 * Find an attached file's SDK {@link FileAttributes} on an item by file ID.
 * Checks both the `files` array and the single `document` attribute that
 * Document-category items carry instead of a `files` entry.
 */
export function findItemFileAttributes(item: Item, fileId: string): FileAttributes | undefined {
  if (item.document?.id === fileId) return item.document
  return item.files?.find((file) => file.attributes.id === fileId)?.attributes
}

/**
 * Convert a Connect-shaped item (the vocabulary `normalizeSdkItem` produces and
 * this integration's tools document — `label`/`type`/`section: {id}`) back into
 * an SDK-compatible {@link Item} for `client.items.put()`. Falls back to `existing`
 * for any array the caller didn't provide, so partial input (e.g. Replace Item's
 * optional fields) is preserved.
 *
 * Service Account mode must always convert through this function before calling
 * `put()` — never apply a Connect-shaped JSON Patch directly onto a raw SDK
 * {@link Item}, since SDK field/category vocabulary differs from Connect's
 * (`title` vs `label`, `fieldType` vs `type`, `sectionId` vs `section.id`, SDK
 * category enum strings vs Connect's SCREAMING_SNAKE_CASE) and silently no-ops or
 * corrupts the write otherwise.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function connectItemToSdkItem(connectItem: Record<string, any>, existing: Item): Item {
  const existingFieldsById = new Map((existing.fields ?? []).map((f) => [f.id, f]))
  const existingSectionsById = new Map((existing.sections ?? []).map((s) => [s.id, s]))

  return {
    ...existing,
    id: existing.id,
    vaultId: existing.vaultId,
    title: connectItem.title || existing.title,
    category: connectItem.category ? toSdkCategory(connectItem.category) : existing.category,
    fields: Array.isArray(connectItem.fields)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connectItem.fields.map((f: Record<string, any>) => ({
          // Preserve any SDK-only metadata (e.g. password-generation `details`)
          // on fields that already existed — only brand-new fields start bare.
          ...(f.id ? existingFieldsById.get(f.id) : undefined),
          id: f.id || generateId().slice(0, 8),
          title: f.label || f.title || '',
          fieldType: toSdkFieldType(f.type || 'STRING'),
          value: f.value || '',
          sectionId: f.section?.id ?? f.sectionId,
        }))
      : existing.fields,
    sections: Array.isArray(connectItem.sections)
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connectItem.sections.map((s: Record<string, any>) => ({
          ...(s.id ? existingSectionsById.get(s.id) : undefined),
          id: s.id || '',
          title: s.label || s.title || '',
        }))
      : existing.sections,
    notes: connectItem.notes ?? existing.notes,
    tags: connectItem.tags ?? existing.tags,
    websites: Array.isArray(connectItem.urls ?? connectItem.websites)
      ? (connectItem.urls ?? connectItem.websites).map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (u: Record<string, any>) => ({
            url: u.href || u.url || '',
            label: u.label || '',
            autofillBehavior: 'AnywhereOnWebsite' as const,
          })
        )
      : existing.websites,
  } as Item
}

/**
 * Best-effort SCIM `eq` filter matcher for Service Account mode, which has no
 * server-side filtering (unlike Connect, whose `filter` query param is forwarded
 * verbatim and evaluated by the Connect server). Recognizes `attribute eq "value"`
 * (quotes optional) as an exact, case-insensitive match against the named attribute
 * — `id` compares against the id, anything else (name/title/etc.) against the
 * display value; anything that doesn't parse as `eq` falls back to a
 * case-insensitive substring match against both so the field remains useful for
 * free-text search.
 */
export function matchesFilter(value: string, id: string, filter: string): boolean {
  const eqMatch = filter.match(/^\s*(\S+)\s+eq\s+"?([^"]*)"?\s*$/i)
  if (eqMatch) {
    const [, attribute, needle] = eqMatch
    const target = attribute.toLowerCase() === 'id' ? id : value
    return target.toLowerCase() === needle.toLowerCase()
  }
  const needle = filter.toLowerCase()
  return value.toLowerCase().includes(needle) || id.toLowerCase().includes(needle)
}

/** Convert a Connect-style category string to the SDK category string. */
export function toSdkCategory(category: string): `${ItemCategory}` {
  return CONNECT_TO_SDK_CATEGORY[category] ?? 'Login'
}

/** Convert a Connect-style field type string to the SDK field type string. */
export function toSdkFieldType(type: string): `${ItemFieldType}` {
  return CONNECT_TO_SDK_FIELD_TYPE[type] ?? 'Text'
}
