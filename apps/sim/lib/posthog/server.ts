import { createLogger, getRequestContext } from '@sim/logger'
import type { PostHog } from 'posthog-node'
import type { PostHogEventMap, PostHogEventName } from '@/lib/posthog/events'

const logger = createLogger('PostHogServer')

let _client: PostHog | null = null
let _disabled = false

export function getPostHogClient(): PostHog | null {
  return getClient()
}

function getClient(): PostHog | null {
  if (_disabled) return null
  if (_client) return _client

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const enabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED

  if (!key || !enabled || enabled === 'false' || enabled === '0') {
    _disabled = true
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PostHog } = require('posthog-node') as typeof import('posthog-node')
  _client = new PostHog(key, {
    host: 'https://us.i.posthog.com',
    flushAt: 20,
    flushInterval: 10_000,
  })
  return _client
}

type PersonProperties = Record<string, string | number | boolean>

interface CaptureOptions {
  /** Stable event identity used by PostHog to collapse retried server captures. */
  insertId?: string
  /**
   * Associate this event with workspace-level group analytics.
   * Pass `{ workspace: workspaceId }`.
   */
  groups?: Record<string, string>
  /**
   * Person properties to update on every capture (`$set`).
   * Use for mutable state like `plan`, `total_workflows`.
   */
  set?: PersonProperties
  /**
   * Person properties to set only once (`$set_once`).
   * Use for immutable milestones like `first_execution_at`.
   */
  setOnce?: PersonProperties
}

/**
 * What the ambient request context contributes to every event: the request it
 * happened in, which client the user was on (web, desktop, CLI, an SDK) and,
 * for the CLI, which AI coding agent was driving it; how the request
 * authenticated; and, when one workflow's run made the call, the chain of
 * workflows behind it. Stamped here rather than at each of the many capture
 * sites so no event can forget it, and only for properties the caller did not
 * set itself.
 */
function contextProperties(explicit: Record<string, unknown>): Record<string, unknown> {
  const context = getRequestContext()
  if (!context) return {}
  const merged: Record<string, unknown> = {}
  const stamp = (key: string, value: unknown) => {
    if (value !== undefined && !(key in explicit)) merged[key] = value
  }

  stamp('request_id', context.requestId)
  stamp('api_method', context.method)
  stamp('api_path', context.path)

  stamp('surface', context.client?.surface)
  stamp('client_version', context.client?.version)
  stamp('coding_agent', context.client?.agent)

  stamp('auth_kind', context.auth?.kind)
  stamp('auth_service', context.auth?.service)
  stamp('auth_client_id', context.auth?.clientId)

  const chain = context.callChain
  if (chain && chain.length > 0) {
    stamp('call_chain_depth', chain.length)
    stamp('call_chain_root_workflow_id', chain[0])
    stamp('caller_workflow_id', chain[chain.length - 1])
  }
  return merged
}

function buildCaptureProperties<E extends PostHogEventName>(
  properties: PostHogEventMap[E],
  options?: CaptureOptions
): Record<string, unknown> {
  const props = properties as Record<string, unknown>
  return {
    ...properties,
    ...contextProperties(props),
    ...(options?.insertId ? { $insert_id: options.insertId } : {}),
    ...(options?.groups ? { $groups: options.groups } : {}),
    ...(options?.set ? { $set: options.set } : {}),
    ...(options?.setOnce ? { $set_once: options.setOnce } : {}),
  }
}

/**
 * Capture a server-side PostHog event. Fire-and-forget — never throws.
 *
 * @param distinctId - The user (or workspace/org) ID to associate the event with.
 * @param event      - Typed event name from {@link PostHogEventMap}.
 * @param properties - Strongly-typed property bag for this event.
 * @param options    - Optional groups, $set, and $set_once person properties.
 */
export function captureServerEvent<E extends PostHogEventName>(
  distinctId: string,
  event: E,
  properties: PostHogEventMap[E],
  options?: CaptureOptions
): void {
  try {
    const client = getClient()
    if (!client) return

    client.capture({
      distinctId,
      event,
      properties: buildCaptureProperties(properties, options),
    })
  } catch (error) {
    logger.warn('Failed to capture PostHog server event', { event, error })
  }
}
