/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  googleDelegationServiceFor,
  googleInitialDelegatedServices,
  googleKeylessOffer,
  googleWorkloadIdentitySetupCommands,
} from '@/lib/credentials/google-workload-identity'

describe('keyless setup in the Google service account dialog', () => {
  it.each(['google-forms', 'google-contacts', 'google-tasks'])(
    'never offers the keyless form when reconnecting a keyless credential from %s',
    (oauthServiceId) => {
      expect(googleKeylessOffer({ oauthServiceId, available: true, reconnectsKeyless: true })).toBe(
        'cloud_only'
      )
    }
  )

  it('offers JSON keys only for a new connection from a Workspace service it cannot delegate', () => {
    expect(
      googleKeylessOffer({
        oauthServiceId: 'google-forms',
        available: true,
        reconnectsKeyless: false,
      })
    ).toBe('none')
  })

  it.each(['gmail', 'google-drive', 'google-docs', 'google-sheets', 'google-calendar'])(
    'offers keyless with domain-wide delegation for %s, new or reconnected',
    (oauthServiceId) => {
      for (const reconnectsKeyless of [true, false]) {
        expect(googleKeylessOffer({ oauthServiceId, available: true, reconnectsKeyless })).toBe(
          'offer'
        )
      }
    }
  )

  it.each([true, false])(
    'offers Gmail keyless from the Integrations page and chat card, which name its provider id (reconnect: %s)',
    (reconnectsKeyless) => {
      expect(
        googleKeylessOffer({ oauthServiceId: 'google-email', available: true, reconnectsKeyless })
      ).toBe('offer')
    }
  )

  it.each([true, false])(
    'offers keyless for BigQuery whether or not the reconnected credential is keyless (%s)',
    (reconnectsKeyless) => {
      expect(
        googleKeylessOffer({
          oauthServiceId: 'google-bigquery',
          available: true,
          reconnectsKeyless,
        })
      ).toBe('offer')
    }
  )

  it('keeps a keyless credential keyless when reconnected from its own page', () => {
    expect(googleKeylessOffer({ available: true, reconnectsKeyless: true })).toBe('offer')
    expect(googleKeylessOffer({ available: true, reconnectsKeyless: false })).toBe('none')
  })

  it('offers nothing keyless where this deployment cannot sign tokens', () => {
    for (const oauthServiceId of ['google-bigquery', 'gmail']) {
      expect(
        googleKeylessOffer({ oauthServiceId, available: false, reconnectsKeyless: true })
      ).toBe('none')
    }
  })
})

describe('the services a keyless dialog opens delegating', () => {
  it('keeps every stored service when reconnected from the credential’s own page', () => {
    expect(googleInitialDelegatedServices(undefined, ['google-calendar', 'gmail'])).toEqual([
      'gmail',
      'google-calendar',
    ])
  })

  it('adds the service the dialog was opened for to the stored ones', () => {
    expect(googleInitialDelegatedServices('google-docs', ['gmail'])).toEqual([
      'gmail',
      'google-docs',
    ])
  })

  it('delegates Gmail when opened by its provider id', () => {
    expect(googleInitialDelegatedServices('google-email', ['google-drive'])).toEqual([
      'gmail',
      'google-drive',
    ])
  })

  it('delegates nothing when opened for a Google Cloud service with nothing stored', () => {
    expect(googleInitialDelegatedServices('google-bigquery')).toEqual([])
  })
})

describe('the delegated service a tool or selector names', () => {
  it.each([
    ['google-email', 'gmail'],
    ['gmail', 'gmail'],
    ['google-drive', 'google-drive'],
    ['google-calendar', 'google-calendar'],
    ['google-bigquery', undefined],
    ['google-forms', undefined],
    [undefined, undefined],
  ])('maps %s to %s', (service, expected) => {
    expect(googleDelegationServiceFor(service)).toBe(expected)
  })
})

describe('keyless setup commands', () => {
  const input = {
    ref: { projectNumber: '123456789012', poolId: 'sim-pool', providerId: 'sim-oidc' },
    serviceAccountEmail: 'runner@analytics-prod.iam.gserviceaccount.com',
    issuer: 'https://sim.example.com/oidc/workload',
    subject: 'sim:workspace:ws-1:credential:abc',
  }

  it('grants only impersonation without domain-wide delegation', () => {
    const commands = googleWorkloadIdentitySetupCommands(input)
    expect(commands).toContain('--role="roles/iam.workloadIdentityUser"')
    expect(commands).not.toContain('serviceAccountTokenCreator')
  })

  it('grants the token creator role, which includes signJwt, with domain-wide delegation', () => {
    const commands = googleWorkloadIdentitySetupCommands({ ...input, domainWideDelegation: true })
    expect(commands).toContain('--role="roles/iam.serviceAccountTokenCreator"')
    expect(commands).toContain(
      '--member="principal://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/sim-pool/subject/sim:workspace:ws-1:credential:abc"'
    )
  })

  it('lists a custom audience in the provider’s allowed audiences', () => {
    const commands = googleWorkloadIdentitySetupCommands({ ...input, audience: 'acme-prod' })
    expect(commands).toContain('--allowed-audiences="acme-prod" \\')
  })

  it.each([
    undefined,
    '',
    'https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/sim-pool/providers/sim-oidc',
    '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/sim-pool/providers/sim-oidc',
  ])('sets no allowed audiences for the default audience (%s)', (audience) => {
    expect(googleWorkloadIdentitySetupCommands({ ...input, audience })).not.toContain(
      '--allowed-audiences'
    )
  })
})
