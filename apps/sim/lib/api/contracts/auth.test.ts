import { describe, expect, it } from 'vitest'
import {
  deleteSsoProviderContract,
  requestSsoDomainVerificationContract,
  updateSsoProviderContract,
  verifySsoDomainContract,
} from './auth'

describe('SSO route contracts', () => {
  it.each([
    updateSsoProviderContract,
    deleteSsoProviderContract,
    requestSsoDomainVerificationContract,
    verifySsoDomainContract,
  ])('uses Next.js-style dynamic parameters for $method $path', (contract) => {
    expect(contract.path).toContain('[id]')
    expect(contract.path).not.toContain(':id')
  })
})
