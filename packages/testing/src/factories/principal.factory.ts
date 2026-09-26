import type {
  PersonalApiKeyPrincipal,
  SessionPrincipal,
  SubjectDelegatedPrincipal,
  WorkflowExecutionDelegatedPrincipal,
  WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'

/**
 * Fixed issue time for delegated principals, so assertions and snapshots stay
 * deterministic. Pair with {@link TEST_PRINCIPAL_EXPIRES_AT}.
 */
export const TEST_PRINCIPAL_ISSUED_AT = new Date('2026-01-01T00:00:00.000Z')

/** Far-future expiry: a delegated principal from these factories never expires mid-test. */
export const TEST_PRINCIPAL_EXPIRES_AT = new Date('2099-01-01T00:00:00.000Z')

/**
 * A browser-session principal. Defaults: `user-1` / `session-1`.
 *
 * @example
 * ```ts
 * await renameWidget({ principal: createSessionPrincipal({ userId: 'admin' }), ... })
 * ```
 */
export function createSessionPrincipal(
  overrides: Partial<SessionPrincipal> = {}
): SessionPrincipal {
  return { kind: 'session', userId: 'user-1', sessionId: 'session-1', ...overrides }
}

/** A personal-API-key principal. Defaults: `user-1` / `key-1`. */
export function createPersonalApiKeyPrincipal(
  overrides: Partial<PersonalApiKeyPrincipal> = {}
): PersonalApiKeyPrincipal {
  return { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1', ...overrides }
}

/** A workspace-API-key principal. Defaults: `workspace-1` / `key-1`. */
export function createWorkspaceApiKeyPrincipal(
  overrides: Partial<WorkspaceApiKeyPrincipal> = {}
): WorkspaceApiKeyPrincipal {
  return { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1', ...overrides }
}

/**
 * A subject-delegated principal (Sim's Chat agent, or realtime) acting for a
 * user. Defaults: `copilot` for `user-1` in `workspace-1`, delegation
 * `delegation-1`, audience `sim:test`, issued {@link TEST_PRINCIPAL_ISSUED_AT},
 * expiring {@link TEST_PRINCIPAL_EXPIRES_AT} (each fixture gets its own `Date`
 * copies, so mutating one cannot leak into another). Pass `audience` whenever
 * the code under test checks it.
 *
 * @example
 * ```ts
 * const principal = createDelegatedPrincipal({ audience: 'sim:tables' })
 * ```
 */
export function createDelegatedPrincipal(
  overrides: Partial<SubjectDelegatedPrincipal> = {}
): SubjectDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:test',
    issuedAt: new Date(TEST_PRINCIPAL_ISSUED_AT),
    expiresAt: new Date(TEST_PRINCIPAL_EXPIRES_AT),
    ...overrides,
  }
}

/**
 * A workflow-executor delegated principal. Same defaults as
 * {@link createDelegatedPrincipal} with `serviceId: 'executor'`; no
 * `delegationContext` unless one is passed.
 *
 * @example
 * ```ts
 * const principal = createExecutorPrincipal({
 *   audience: 'sim:workflows',
 *   delegationContext: { kind: 'workflow_execution', workflowId: 'wf-1' },
 * })
 * ```
 */
export function createExecutorPrincipal(
  overrides: Partial<WorkflowExecutionDelegatedPrincipal> = {}
): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: 'user-1',
    workspaceId: 'workspace-1',
    delegationId: 'delegation-1',
    audience: 'sim:test',
    issuedAt: new Date(TEST_PRINCIPAL_ISSUED_AT),
    expiresAt: new Date(TEST_PRINCIPAL_EXPIRES_AT),
    ...overrides,
  }
}
