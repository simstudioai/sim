import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'

export const DEPLOYMENT_OPERATION_PROTOCOL_VERSION = 2

export const DEPLOYMENT_OPERATION_STATUSES = [
  'preparing',
  'activating',
  'active',
  'failed',
  'superseded',
] as const

export const DEPLOYMENT_OPERATION_ACTIONS = ['deploy', 'activate'] as const

export const DEPLOYMENT_COMPONENT_STATUSES = ['pending', 'ready'] as const

export type DeploymentOperationStatus = (typeof DEPLOYMENT_OPERATION_STATUSES)[number]
export type DeploymentOperationAction = (typeof DEPLOYMENT_OPERATION_ACTIONS)[number]
export type DeploymentComponentStatus = (typeof DEPLOYMENT_COMPONENT_STATUSES)[number]

export interface SafeDeploymentError {
  code: string
  message: string
}

export interface DeploymentComponentReadiness {
  status: DeploymentComponentStatus
  updatedAt: string
}

export type DeploymentReadiness = Record<string, DeploymentComponentReadiness>

const ALLOWED_TRANSITIONS: Readonly<
  Record<DeploymentOperationStatus, DeploymentOperationStatus[]>
> = {
  preparing: ['activating', 'failed', 'superseded'],
  activating: ['active', 'failed', 'superseded'],
  active: [],
  failed: [],
  superseded: [],
}

const MAX_ERROR_CODE_LENGTH = 64
const MAX_ERROR_MESSAGE_LENGTH = 500

/**
 * Narrows a persisted value to a supported operation status.
 */
export function isDeploymentOperationStatus(value: unknown): value is DeploymentOperationStatus {
  return DEPLOYMENT_OPERATION_STATUSES.includes(value as DeploymentOperationStatus)
}

/**
 * Narrows a persisted value to a supported operation action.
 */
export function isDeploymentOperationAction(value: unknown): value is DeploymentOperationAction {
  return DEPLOYMENT_OPERATION_ACTIONS.includes(value as DeploymentOperationAction)
}

/**
 * Returns whether an operation may move between two lifecycle states.
 */
export function canTransitionDeploymentOperation(
  from: DeploymentOperationStatus,
  to: DeploymentOperationStatus
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * Builds the initial readiness map for the components required by an attempt.
 */
export function createDeploymentReadiness(
  components: readonly string[],
  updatedAt = new Date()
): DeploymentReadiness {
  const readiness: DeploymentReadiness = {}
  for (const component of components) {
    const normalizedComponent = component.trim()
    if (!normalizedComponent) {
      throw new Error('Deployment readiness component names cannot be empty')
    }
    if (readiness[normalizedComponent]) {
      throw new Error(`Duplicate deployment readiness component: ${normalizedComponent}`)
    }
    readiness[normalizedComponent] = {
      status: 'pending',
      updatedAt: updatedAt.toISOString(),
    }
  }
  return readiness
}

/**
 * Returns true only when every declared component is ready.
 */
export function isDeploymentReadinessComplete(readiness: DeploymentReadiness): boolean {
  return Object.values(readiness).every((component) => component.status === 'ready')
}

/**
 * Narrows persisted JSON to the lifecycle readiness shape.
 */
export function parseDeploymentReadiness(value: unknown): DeploymentReadiness | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const readiness: DeploymentReadiness = {}
  for (const [component, rawState] of Object.entries(value)) {
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) return null

    const state = rawState as Record<string, unknown>
    if (
      !DEPLOYMENT_COMPONENT_STATUSES.includes(state.status as DeploymentComponentStatus) ||
      typeof state.updatedAt !== 'string'
    ) {
      return null
    }

    readiness[component] = {
      status: state.status as DeploymentComponentStatus,
      updatedAt: state.updatedAt,
    }
  }

  return readiness
}

/**
 * A preparation failure that cannot succeed on retry (path conflicts, invalid
 * trigger configuration). The outbox handler fails the operation immediately
 * instead of burning the full retry budget.
 */
export class NonRetryableDeploymentError extends Error {
  constructor(
    message: string,
    readonly errorCode: string = 'preparation_failed'
  ) {
    super(message)
    this.name = 'NonRetryableDeploymentError'
  }
}

/**
 * Narrows an unknown caught value to {@link NonRetryableDeploymentError}.
 */
export function isNonRetryableDeploymentError(
  error: unknown
): error is NonRetryableDeploymentError {
  return error instanceof NonRetryableDeploymentError
}

/**
 * Converts an unknown failure into the bounded public shape persisted on an attempt.
 */
export function toSafeDeploymentError(error: unknown, errorCode?: string): SafeDeploymentError {
  const source =
    errorCode ??
    (error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? 'deployment_failed')
      : 'deployment_failed')
  const code =
    truncate(
      source
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '_'),
      MAX_ERROR_CODE_LENGTH,
      ''
    ) || 'deployment_failed'

  const message = sanitizeDeploymentErrorMessage(
    getErrorMessage(error, 'Deployment operation failed')
  )
  return { code, message }
}

function sanitizeDeploymentErrorMessage(message: string): string {
  const withoutControlCharacters = message.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim()
  const withoutUrlCredentials = withoutControlCharacters.replace(
    /:\/\/[^/\s:@]+:[^/\s@]+@/g,
    '://[redacted]@'
  )
  const withoutSecrets = withoutUrlCredentials.replace(
    /\b(authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password)\b(\s*[:=]\s*)([^\s,;]+)/gi,
    '$1$2[redacted]'
  )
  return truncate(withoutSecrets || 'Deployment operation failed', MAX_ERROR_MESSAGE_LENGTH, '')
}
