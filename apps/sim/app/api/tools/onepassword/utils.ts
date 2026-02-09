import { createLogger } from '@sim/logger'

const logger = createLogger('OnePasswordRouteUtils')

/**
 * SDK field type string values → Connect field type mapping.
 * Uses string literals instead of enum imports to avoid loading the WASM module at build time.
 */
const SDK_TO_CONNECT_FIELD_TYPE: Record<string, string> = {
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
const SDK_TO_CONNECT_CATEGORY: Record<string, string> = {
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
const CONNECT_TO_SDK_CATEGORY: Record<string, string> = {
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
const CONNECT_TO_SDK_FIELD_TYPE: Record<string, string> = {
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
  connectionMode?: ConnectionMode
  serviceAccountToken?: string
  serverUrl?: string
  apiKey?: string
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

/** Proxy a request to the 1Password Connect Server. */
export async function connectRequest(options: {
  serverUrl: string
  apiKey: string
  path: string
  method: string
  body?: unknown
  query?: string
}): Promise<Response> {
  const base = options.serverUrl.replace(/\/$/, '')
  const queryStr = options.query ? `?${options.query}` : ''
  const url = `${base}${options.path}${queryStr}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json'
  }

  logger.info(`Connect request: ${options.method} ${options.path}`)

  return fetch(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
}

/** Normalize an SDK VaultOverview to match Connect API vault shape. */
export function normalizeSdkVault(vault: Record<string, any>) {
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
export function normalizeSdkItemOverview(item: Record<string, any>) {
  return {
    id: item.id,
    title: item.title,
    vault: { id: item.vaultId },
    category: SDK_TO_CONNECT_CATEGORY[item.category] ?? 'CUSTOM',
    urls: (item.websites ?? []).map((w: Record<string, any>) => ({
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
export function normalizeSdkItem(item: Record<string, any>) {
  return {
    id: item.id,
    title: item.title,
    vault: { id: item.vaultId },
    category: SDK_TO_CONNECT_CATEGORY[item.category] ?? 'CUSTOM',
    urls: (item.websites ?? []).map((w: Record<string, any>) => ({
      href: w.url,
      label: w.label ?? null,
      primary: false,
    })),
    favorite: false,
    tags: item.tags ?? [],
    version: item.version ?? 0,
    state: null,
    fields: (item.fields ?? []).map((field: Record<string, any>) => ({
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
    sections: (item.sections ?? []).map((section: Record<string, any>) => ({
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
export function toSdkCategory(category: string): string {
  return CONNECT_TO_SDK_CATEGORY[category] ?? 'Login'
}

/** Convert a Connect-style field type string to the SDK field type string. */
export function toSdkFieldType(type: string): string {
  return CONNECT_TO_SDK_FIELD_TYPE[type] ?? 'Text'
}
