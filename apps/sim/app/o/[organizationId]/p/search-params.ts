import { parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { RESOURCE_TAB_IDS } from '@/app/o/[organizationId]/p/components/environments/mapping-model'

export const projectParsers = {
  /** Dashboard shown on the project page: a dashboard file id, or `runs`. */
  dashboard: parseAsString.withDefault(''),
  /** The fork whose sync with its parent is under review in the Environments tab. */
  edge: parseAsString.withDefault(''),
  /** That sync's direction: `push` promotes the fork into its parent, `pull` refreshes it. */
  sync: parseAsStringLiteral(['push', 'pull'] as const).withDefault('push'),
  /** Narrows the Environments tab's mappings table by resource name. */
  mappingSearch: parseAsString.withDefault(''),
  /** Resource types the Environments tab's mappings table shows; empty shows every type. */
  resource: parseAsArrayOf(parseAsStringLiteral(RESOURCE_TAB_IDS)).withDefault([]),
}
