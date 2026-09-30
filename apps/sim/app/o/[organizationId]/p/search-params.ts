import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import { RESOURCE_TAB_IDS } from '@/app/o/[organizationId]/p/components/environments/mapping-model'

export const projectParsers = {
  /** Chat open in the side panel next to the project; `new` before the first message. */
  chat: parseAsString.withDefault(''),
  /** Project a new Build chat starts in from Home; `none` means an organization chat. */
  project: parseAsString.withDefault(''),
  /** First message handed from Home to a project's new chat; sent once, then cleared. */
  q: parseAsString.withDefault(''),
  /** Dashboard shown on the project page: a dashboard file id, or `runs`. */
  dashboard: parseAsString.withDefault(''),
  /** The fork whose sync with its parent is under review in the Environments tab. */
  edge: parseAsString.withDefault(''),
  /** That sync's direction: `push` promotes the fork into its parent, `pull` refreshes it. */
  sync: parseAsStringLiteral(['push', 'pull'] as const).withDefault('push'),
  /** Resource type shown in the Environments tab: workflows, then the mapping kinds. */
  resource: parseAsStringLiteral(RESOURCE_TAB_IDS).withDefault('workflow'),
}
