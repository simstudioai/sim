/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  googleDelegationServiceFor,
  googleKeylessOffer,
  googleWorkloadIdentitySetupCommands,
} from '@/lib/credentials/google-workload-identity'

describe('keyless setup in the Google service account dialog', () => {
  it.each(['google-drive', 'gmail', 'google-sheets'])(
    'never offers the keyless form when reconnecting a keyless credential from %s',
    (oauthServiceId) => {
      expect(googleKeylessOffer({ oauthServiceId, available: true, reconnectsKeyless: true })).toBe(
        'cloud_only'
      )
    }
  )

  it('offers JSON keys only for a new connection from a Workspace service', () => {
    expect(
      googleKeylessOffer({ oauthServiceId: 'gmail', available: true, reconnectsKeyless: false })
    ).toBe('none')
  })

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
    expect(
      googleKeylessOffer({
        oauthServiceId: 'google-bigquery',
        available: false,
        reconnectsKeyless: true,
      })
    ).toBe('none')
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
})
