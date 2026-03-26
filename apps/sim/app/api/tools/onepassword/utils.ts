import dns from 'dns/promises'
import type {
  Item,
  ItemCategory,
  ItemField,
  ItemFieldType,
  ItemOverview,
  ItemSection,
  VaultOverview,
  Website,
} from '@1password/sdk'
import { createLogger } from '@sim/logger'
import * as ipaddr from 'ipaddr.js'
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
export interface NormalizedField {
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

/** Normalized full item shape matching the Connect API response. */
export interface NormalizedItem extends NormalizedItemOverview {
  fields: NormalizedField[]
  sections: Array<{ id: string; label: string }>
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
 * Validates that a Connect server URL does not target cloud metadata endpoints.
 * Allows private IPs and localhost since 1Password Connect is designed to be self-hosted.
 * Returns the resolved IP for DNS pinning to prevent TOCTOU rebinding.
 * @throws Error if the URL is invalid, points to a link-local address, or DNS fails.
 */
async function validateConnectServerUrl(serverUrl: string): Promise<string> {
  let hostname: string
  try {
    hostname = new URL(serverUrl).hostname
  } catch {
    throw new Error('1Password server URL is not a valid URL')
  }

  const clean =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname

  if (ipaddr.isValid(clean)) {
    const addr = ipaddr.process(clean)
    if (addr.range() === 'linkLocal') {
      throw new Error('1Password server URL cannot point to a link-local address')
    }
    return clean
  }

  try {
    const { address } = await dns.lookup(clean, { verbatim: true })
    if (ipaddr.isValid(address) && ipaddr.process(address).range() === 'linkLocal') {
      connectLogger.warn('1Password Connect server URL resolves to link-local IP', {
        hostname: clean,
        resolvedIP: address,
      })
      throw new Error('1Password server URL resolves to a link-local address')
    }
    return address
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('1Password')) throw error
    connectLogger.warn('DNS lookup failed for 1Password Connect server URL', {
      hostname: clean,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error('1Password server URL hostname could not be resolved')
  }
}

/** Minimal response shape used by all connectRequest callers. */
export interface ConnectResponse {
  ok: boolean
  status: number
  statusText: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => Promise<any>
  text: () => Promise<string>
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
    createdAt:
      item.createdAt instanceof Date ? item.createdAt.toISOString() : (item.createdAt ?? null),
    updatedAt:
      item.updatedAt instanceof Date ? item.updatedAt.toISOString() : (item.updatedAt ?? null),
    lastEditedBy: null,
  }
}

/** Convert a Connect-style category string to the SDK category string. */
export function toSdkCategory(category: string): `${ItemCategory}` {
  return CONNECT_TO_SDK_CATEGORY[category] ?? 'Login'
}

/** Convert a Connect-style field type string to the SDK field type string. */
export function toSdkFieldType(type: string): `${ItemFieldType}` {
  return CONNECT_TO_SDK_FIELD_TYPE[type] ?? 'Text'
}
