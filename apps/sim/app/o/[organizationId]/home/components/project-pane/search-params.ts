import { parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'

/** Project names are presentation; workspace ids address the selected environment. */
export const projectPaneParsers = {
  project: parseAsString.withDefault(''),
  section: parseAsStringLiteral([
    'dashboard',
    'changelog',
    'issues',
    'environments',
    'settings',
    'resources',
  ] as const).withDefault('dashboard'),
  resourceKind: parseAsString.withDefault(''),
  resourceDetail: parseAsString.withDefault(''),
  pane: parseAsString.withDefault(''),
  browse: parseAsArrayOf(parseAsString).withDefault([]),
}

export const projectPaneOptions = { history: 'push', clearOnDefault: true } as const
