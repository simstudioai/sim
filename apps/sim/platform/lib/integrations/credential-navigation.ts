import {
  createSerializer,
  type inferParserType,
  parseAsString,
  parseAsStringLiteral,
} from 'nuqs/server'

export const credentialDetailParams = {
  credentialTab: parseAsStringLiteral(['details', 'access', 'permissions']).withDefault('details'),
}

export const credentialAccessParams = {
  accessTab: parseAsStringLiteral(['people', 'invitations']).withDefault('people'),
  accessQ: parseAsString.withDefault(''),
  accessRole: parseAsStringLiteral([
    'all',
    'admin',
    'member',
    'organization-admin',
    'workspace-admin',
  ]).withDefault('all'),
  accessOrder: parseAsStringLiteral(['asc', 'desc']).withDefault('asc'),
}

export type CredentialAccessView = inferParserType<typeof credentialAccessParams>

export const credentialParams = {
  credential: parseAsString.withDefault(''),
  credentialFrom: parseAsStringLiteral(['app', 'credentials']).withDefault('app'),
  ...credentialDetailParams,
  ...credentialAccessParams,
}

export const serializeCredential = createSerializer(credentialParams)

export const clearCredentialView = {
  credentialFrom: null,
  credentialTab: null,
  accessTab: null,
  accessQ: null,
  accessRole: null,
  accessOrder: null,
} as const
