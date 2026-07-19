/**
 * @vitest-environment node
 *
 * The §2.3 authorization chain is the security core of interface sharing: a
 * share token is a capability for exactly one interface and, through it, the
 * single resource each of that interface's *currently stored* modules
 * references. These tests pin both halves — the positive chain, and the
 * negative cases that would turn one shared interface into a read-anything
 * hole over its whole workspace.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterfaceDefinition, InterfaceModule } from '@/lib/interfaces'

const {
  mockResolveActiveInterfaceShareByToken,
  mockResolveActiveShareByToken,
  mockValidateDeploymentAuth,
} = vi.hoisted(() => ({
  mockResolveActiveInterfaceShareByToken: vi.fn(),
  mockResolveActiveShareByToken: vi.fn(),
  mockValidateDeploymentAuth: vi.fn(),
}))

vi.mock('@/lib/public-shares/share-manager', () => ({
  resolveActiveInterfaceShareByToken: mockResolveActiveInterfaceShareByToken,
  resolveActiveShareByToken: mockResolveActiveShareByToken,
}))

vi.mock('@/lib/core/security/deployment-auth', () => ({
  validateDeploymentAuth: mockValidateDeploymentAuth,
}))

import { resolvePublicInterfaceModule } from '@/lib/public-shares/interface-access'

const TOKEN = 'tok_interface_a'
const WS = 'ws-a'
const OTHER_WS = 'ws-b'

const chatModule: InterfaceModule = {
  id: 'mod-chat',
  type: 'chat',
  placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
  config: { workflowId: 'wf-stored', outputConfigs: [], showThinking: false, welcomeMessage: '' },
}

const tableModule: InterfaceModule = {
  id: 'mod-table',
  type: 'table',
  placement: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
  config: { tableId: 'tbl-stored' },
}

const fileModule: InterfaceModule = {
  id: 'mod-file',
  type: 'file',
  placement: { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
  config: { fileId: 'file-stored' },
}

const formModule: InterfaceModule = {
  id: 'mod-form',
  type: 'form',
  placement: { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
  config: { workflowId: 'wf-form-stored', fields: [], submitLabel: 'Submit' },
}

const unconfiguredTableModule: InterfaceModule = {
  id: 'mod-unconfigured',
  type: 'table',
  placement: { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
  config: { tableId: null },
}

function buildDefinition(
  modules: InterfaceModule[],
  overrides: Partial<InterfaceDefinition> = {}
): InterfaceDefinition {
  return {
    id: 'int-a',
    workspaceId: WS,
    name: 'Support desk',
    description: null,
    layout: { version: 1, grid: { rows: 2, cols: 2 }, modules },
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

function buildResolved(
  modules: InterfaceModule[] = [chatModule, tableModule, fileModule, formModule],
  share: Record<string, unknown> = {}
) {
  const definition = buildDefinition(modules)
  return {
    share: {
      id: 'sh_1',
      token: TOKEN,
      authType: 'public',
      password: null,
      allowedEmails: [],
      ...share,
    },
    definition,
    workspaceId: definition.workspaceId,
    workspaceName: 'Acme',
    ownerName: 'Ada',
  }
}

/** A request carrying attacker-controlled ids in the query string. */
function request(query = ''): NextRequest {
  return new NextRequest(
    `http://localhost/api/interfaces/public/${TOKEN}/modules/mod-table/table/rows${query}`
  )
}

function call(overrides: Partial<Parameters<typeof resolvePublicInterfaceModule>[0]> = {}) {
  return resolvePublicInterfaceModule({
    token: TOKEN,
    moduleId: 'mod-table',
    expectedType: 'table',
    request: request(),
    requestId: 'req-1',
    ...overrides,
  })
}

describe('resolvePublicInterfaceModule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveActiveInterfaceShareByToken.mockResolvedValue(buildResolved())
    mockValidateDeploymentAuth.mockResolvedValue({ authorized: true })
  })

  describe('STEP 1 — token resolves to an active, non-archived interface', () => {
    it('resolves through the interface resolver, never the file resolver', async () => {
      await call()
      expect(mockResolveActiveInterfaceShareByToken).toHaveBeenCalledWith(TOKEN)
      expect(mockResolveActiveShareByToken).not.toHaveBeenCalled()
    })

    it('404s an unknown, inactive, or archived token without running the auth gate', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(null)
      const result = await call()
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
      expect(mockValidateDeploymentAuth).not.toHaveBeenCalled()
    })

    it('never leaks interface existence in the 404 body', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(null)
      const result = await call()
      expect(result.ok).toBe(false)
      if (result.ok) return
      const body = JSON.stringify(await result.response.json())
      expect(body).not.toContain('int-a')
      expect(body).not.toContain(WS)
      expect(body).not.toContain('Support desk')
    })

    /**
     * §2.2 — the layout is the capability list, so it is re-read from the DB on
     * every request rather than memoized across them.
     */
    it('re-resolves the share on every call', async () => {
      await call()
      await call()
      expect(mockResolveActiveInterfaceShareByToken).toHaveBeenCalledTimes(2)
    })
  })

  describe('STEP 2 — share auth gate', () => {
    it('validates against the interface cookie namespace, not the file one', async () => {
      await call()
      expect(mockValidateDeploymentAuth).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ id: 'sh_1' }),
        expect.anything(),
        undefined,
        'interface'
      )
    })

    it('forwards the parsed body to the password/email branches', async () => {
      const parsedBody = { password: 'hunter22' }
      await call({ parsedBody })
      expect(mockValidateDeploymentAuth).toHaveBeenCalledWith(
        'req-1',
        expect.anything(),
        expect.anything(),
        parsedBody,
        'interface'
      )
    })

    it.each([
      ['password', 'auth_required_password'],
      ['email', 'auth_required_email'],
      ['email', 'otp_required'],
      ['sso', 'auth_required_sso'],
    ])('401s an unauthorized %s share with %s', async (authType, error) => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(
        buildResolved(undefined, { authType })
      )
      mockValidateDeploymentAuth.mockResolvedValueOnce({ authorized: false, error })
      const result = await call()
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(401)
      expect((await result.response.json()).error).toBe(error)
    })

    it('never derives a resource for an unauthorized request', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(
        buildResolved(undefined, { authType: 'password' })
      )
      mockValidateDeploymentAuth.mockResolvedValueOnce({
        authorized: false,
        error: 'auth_required_password',
      })
      const result = await call()
      expect(result.ok).toBe(false)
      if (result.ok) return
      const body = JSON.stringify(await result.response.json())
      expect(body).not.toContain('tbl-stored')
      expect(body).not.toContain(WS)
    })

    /**
     * §2.3 STEP 2 — data routes answer 401 for every unauthorized outcome and
     * carry `Retry-After` only as a hint, matching the file content/inline
     * precedent. The password-exchange route is the one that surfaces a real
     * 429, because it is the surface the gate UI posts to.
     */
    it('answers 401 with a Retry-After hint when the password guess is throttled', async () => {
      mockValidateDeploymentAuth.mockResolvedValueOnce({
        authorized: false,
        error: 'Too many attempts. Please try again later.',
        status: 429,
        retryAfterMs: 60_000,
      })
      const result = await call()
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(401)
      expect(result.response.headers.get('Retry-After')).toBe('60')
    })
  })

  describe('STEP 3 — the module must exist in THIS interface stored layout', () => {
    it('404s a module id that is not in the layout', async () => {
      const result = await call({ moduleId: 'mod-not-here' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
    })

    /**
     * §2.1 — a token for interface A must not read interface B's data. The
     * layout comes from the row the token resolved to, so a module id belonging
     * to another interface simply is not found.
     */
    it("404s a module id that belongs to a different interface's layout", async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(buildResolved([tableModule]))
      const result = await call({ moduleId: 'mod-of-interface-b' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
    })

    it('404s when the module type does not match the route', async () => {
      const result = await call({ moduleId: 'mod-file', expectedType: 'table' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
    })

    it('404s when a chat route addresses a form module', async () => {
      const result = await call({ moduleId: 'mod-form', expectedType: 'chat' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
    })
  })

  describe('STEP 4 — derive the resource, never accept it', () => {
    it('404s an unconfigured module', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(
        buildResolved([unconfiguredTableModule])
      )
      const result = await call({ moduleId: 'mod-unconfigured' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
    })

    it('derives the table id from the stored layout, ignoring the request', async () => {
      const result = await call({
        request: request('?tableId=tbl-attacker&fileId=file-attacker&workflowId=wf-attacker'),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.access.resource).toEqual({ type: 'table', id: 'tbl-stored' })
    })

    it.each([
      ['mod-chat', 'chat', { type: 'workflow', id: 'wf-stored' }],
      ['mod-form', 'form', { type: 'workflow', id: 'wf-form-stored' }],
      ['mod-table', 'table', { type: 'table', id: 'tbl-stored' }],
      ['mod-file', 'file', { type: 'file', id: 'file-stored' }],
    ])('derives %s to %s', async (moduleId, expectedType, resource) => {
      const result = await call({
        moduleId,
        expectedType: expectedType as 'chat' | 'form' | 'table' | 'file',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.access.resource).toEqual(resource)
    })

    it('returns the interface own workspace for the STEP 5 re-assert', async () => {
      const result = await call()
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.access.workspaceId).toBe(WS)
      expect(result.access.definition.workspaceId).toBe(WS)
      expect(result.access.module.id).toBe('mod-table')
      expect(result.access.share.id).toBe('sh_1')
    })

    /**
     * §2.4 — `validateLayout` grandfathers references that were already stored,
     * so `resolvePublicInterfaceModule` deliberately does NOT filter a
     * cross-workspace reference itself. It hands the caller the interface's own
     * workspace so the caller can re-assert; that contract is what the route
     * tests then exercise.
     */
    it('reports the interface workspace even when the module points elsewhere', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce({
        ...buildResolved([tableModule]),
        workspaceId: OTHER_WS,
        definition: buildDefinition([tableModule], { workspaceId: OTHER_WS }),
      })
      const result = await call()
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.access.workspaceId).toBe(OTHER_WS)
    })
  })

  /**
   * §2.5 — what a live link does after the interface changes underneath it. The
   * token freezes nothing: it grants "whatever module M points at *now*", and
   * stops granting anything the moment the share or the interface goes away.
   */
  describe('§2.5 — the link after the interface changes', () => {
    it('stops resolving the moment the share is toggled Private', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(null)
      const revoked = await call()
      expect(revoked.ok).toBe(false)
      if (revoked.ok) return
      expect(revoked.response.status).toBe(404)

      const restored = await call()
      expect(restored.ok).toBe(true)
    })

    it('stops resolving while the interface is archived', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(null)
      const result = await call()
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
    })

    it('404s a module the builder un-wired after the link was shared', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(
        buildResolved([{ ...tableModule, config: { tableId: null } }])
      )
      const result = await call()
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
    })

    it('404s a module the builder deleted after the link was shared', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(buildResolved([chatModule]))
      const result = await call()
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.response.status).toBe(404)
    })

    /**
     * Deliberate: no id is frozen into the token, exactly as a file share serves
     * the file's *current* bytes.
     */
    it('serves the new table after the builder re-points the module', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(
        buildResolved([{ ...tableModule, config: { tableId: 'tbl-repointed' } }])
      )
      const result = await call()
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.access.resource).toEqual({ type: 'table', id: 'tbl-repointed' })
    })

    /**
     * §2.9 — the cookie binds to the auth type and a slot derived from the
     * stored password, so switching modes or rotating the password invalidates
     * every live cookie. `validateDeploymentAuth` owns that check; this pins
     * that it is handed the *current* share row rather than anything cached.
     */
    it('gates against the current share row, not a cached one', async () => {
      mockResolveActiveInterfaceShareByToken.mockResolvedValueOnce(
        buildResolved(undefined, { authType: 'email', password: null, allowedEmails: ['a@b.com'] })
      )
      await call()
      expect(mockValidateDeploymentAuth).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ authType: 'email', allowedEmails: ['a@b.com'] }),
        expect.anything(),
        undefined,
        'interface'
      )
    })
  })
})
