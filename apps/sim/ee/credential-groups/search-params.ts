import { parseAsStringLiteral } from 'nuqs/server'

export const credentialGroupsParsers = {
  tab: parseAsStringLiteral(['providers', 'people', 'workspace-access'] as const).withDefault(
    'providers'
  ),
}
