import { parseAsString, parseAsStringLiteral } from 'nuqs/server'

export const credentialGroupsParsers = {
  tab: parseAsStringLiteral(['providers', 'people', 'workspace-access'] as const).withDefault(
    'providers'
  ),
}

export const credentialGroupWorkspaceSearchParam = {
  key: 'credential-group-workspace',
  parser: parseAsString.withDefault(''),
} as const
