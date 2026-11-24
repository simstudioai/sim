/**
 * @vitest-environment jsdom
 *
 * The root layout projected a server shape onto `<html>` before any script ran, as
 * it does on every real document. Browser `env-flags` constants are computed at
 * module init, so this is what module-scope readers such as the better-auth client's
 * plugin list see.
 */

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  vi.stubEnv('SSO_ENABLED', 'false')
  vi.stubEnv('E2B_ENABLED', 'false')
  vi.stubEnv('SLACK_EXTENDED_SCOPES', 'false')
  vi.stubEnv('DISABLE_INVITATIONS', 'false')
  vi.stubEnv('DISABLE_PUBLIC_API', 'true')
  vi.stubEnv('INBOX_ENABLED', 'true')
  vi.stubEnv('REGISTRATION_MODE', 'open')
  document.documentElement.setAttribute(
    'data-deployment-shape',
    JSON.stringify({
      hosted: false,
      billingEnabled: false,
      chatEnabled: true,
      azureConfigured: false,
      cohereConfigured: false,
      registrationMode: 'closed-no-email',
      e2bEnabled: true,
      slackExtendedScopes: true,
      invitationsDisabled: true,
      features: {
        sso: true,
        accessControl: true,
        organizations: true,
        inbox: false,
        sandboxes: true,
      },
    })
  )
})

vi.unmock('@/lib/core/config/env')
vi.unmock('@/lib/core/config/env-flags')

import {
  getRegistrationMode,
  isAccessControlEnabled,
  isAuditLogsEnabled,
  isE2bEnabled,
  isEmailPasswordAuthEnabled,
  isEmailSignupAllowed,
  isInboxEnabled,
  isInvitationsDisabled,
  isOrganizationsEnabled,
  isPublicApiDisabled,
  isSandboxesEnabled,
  isSelfServeRegistrationClosed,
  isSessionPoliciesEnabled,
  isSlackExtendedScopesEnabled,
  isSsoEnabled,
} from '@/lib/core/config/env-flags'

describe('browser enterprise flags', () => {
  it('take the projected server answer over anything the browser environment holds', () => {
    expect(isSsoEnabled).toBe(true)
    expect(isAccessControlEnabled).toBe(true)
    expect(isOrganizationsEnabled).toBe(true)
    expect(isInboxEnabled).toBe(false)
    expect(isSandboxesEnabled).toBe(true)
  })

  it('fill features the projection omits from the registry defaults', () => {
    expect(isSessionPoliciesEnabled).toBe(true)
    expect(isAuditLogsEnabled).toBe(false)
  })
})

describe('browser registration flags', () => {
  it('take the projected registration mode over the browser environment', () => {
    expect(getRegistrationMode()).toBe('closed-no-email')
    expect(isSelfServeRegistrationClosed).toBe(true)
    expect(isEmailSignupAllowed).toBe(false)
    expect(isEmailPasswordAuthEnabled).toBe(false)
  })
})

describe('browser deployment switches', () => {
  it('take the projected server answer over the browser environment', () => {
    expect(isE2bEnabled).toBe(true)
    expect(isSlackExtendedScopesEnabled).toBe(true)
    expect(isInvitationsDisabled).toBe(true)
  })

  it('read a switch the projection omits as off', () => {
    expect(isPublicApiDisabled).toBe(false)
  })
})
