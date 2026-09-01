import { createLogger } from '@sim/logger'
import { registerHandlers } from './executor'

const logger = createLogger('ToolHandlerRegistration')

let registration: Promise<void> | null = null

/**
 * Registers every server-side tool handler exactly once.
 *
 * The handler map statically imports every copilot tool implementation, which
 * transitively reaches the block registry, table application layer, and most
 * of `lib/` — several thousand modules. Nothing that merely routes or inspects
 * tool calls needs any of that, so the map is loaded on first execution rather
 * than whenever this module is imported.
 */
export function ensureHandlersRegistered(): Promise<void> {
  registration ??= import('./handler-map').then(({ buildHandlerMap }) => {
    registerHandlers(buildHandlerMap())
    logger.info('Tool handlers registered')
  })
  return registration
}
