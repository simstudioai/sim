import { parseAsArrayOf, parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { RESOURCE_TAB_IDS } from '@/app/o/[organizationId]/p/components/environments/mapping-model'

export const projectParsers = {
  /** Dashboard shown on the project page: a dashboard file id, or `runs`. */
  dashboard: parseAsString.withDefault(''),
  /** Narrows a sync tab's mappings table by resource name. */
  mappingSearch: parseAsString.withDefault(''),
  /** Resource types a sync tab's mappings table shows; empty shows every type. */
  resource: parseAsArrayOf(parseAsStringLiteral(RESOURCE_TAB_IDS)).withDefault([]),
}
