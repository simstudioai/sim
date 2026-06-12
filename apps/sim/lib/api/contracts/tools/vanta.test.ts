import { describe, expect, it } from 'vitest'
import {
  vantaDownloadBodySchema,
  vantaQueryBodySchema,
  vantaUploadBodySchema,
} from '@/lib/api/contracts/tools/vanta'

const credentials = {
  clientId: 'vci_test',
  clientSecret: 'vcs_test',
  region: 'us',
} as const

describe('vanta contracts', () => {
  it('accepts serializer nulls for every optional list_vulnerabilities filter', () => {
    const parsed = vantaQueryBodySchema.parse({
      operation: 'vanta_list_vulnerabilities',
      ...credentials,
      q: null,
      severity: null,
      isFixAvailable: null,
      isDeactivated: null,
      includeVulnerabilitiesWithoutSlas: null,
      packageIdentifier: null,
      externalVulnerabilityId: null,
      integrationId: null,
      vulnerableAssetId: null,
      slaDeadlineAfterDate: null,
      slaDeadlineBeforeDate: null,
      pageSize: null,
      pageCursor: null,
    })
    expect(parsed.operation).toBe('vanta_list_vulnerabilities')
  })

  it('accepts null region and pagination on list_frameworks', () => {
    const parsed = vantaQueryBodySchema.parse({
      operation: 'vanta_list_frameworks',
      clientId: 'vci_test',
      clientSecret: 'vcs_test',
      region: null,
      pageSize: null,
      pageCursor: null,
    })
    expect(parsed.operation).toBe('vanta_list_frameworks')
  })

  it('accepts serializer nulls for every optional list_risk_scenarios filter', () => {
    const parsed = vantaQueryBodySchema.parse({
      operation: 'vanta_list_risk_scenarios',
      ...credentials,
      searchString: null,
      includeIgnored: null,
      type: null,
      ownerMatchesAny: null,
      categoryMatchesAny: null,
      ciaCategoryMatchesAny: null,
      treatmentTypeMatchesAny: null,
      inherentScoreGroupMatchesAny: null,
      residualScoreGroupMatchesAny: null,
      reviewStatusMatchesAny: null,
      orderBy: null,
      pageSize: null,
      pageCursor: null,
    })
    expect(parsed.operation).toBe('vanta_list_risk_scenarios')
  })

  it('accepts nulls for optional upload fields', () => {
    const parsed = vantaUploadBodySchema.parse({
      ...credentials,
      documentId: 'doc-1',
      file: null,
      fileContent: null,
      fileName: null,
      mimeType: null,
      description: null,
      effectiveAtDate: null,
    })
    expect(parsed.documentId).toBe('doc-1')
  })

  it('still rejects null for required identifiers', () => {
    expect(() =>
      vantaQueryBodySchema.parse({
        operation: 'vanta_get_framework',
        ...credentials,
        frameworkId: null,
      })
    ).toThrow()
    expect(() =>
      vantaDownloadBodySchema.parse({
        ...credentials,
        documentId: 'doc-1',
        uploadedFileId: null,
      })
    ).toThrow()
  })

  it('still rejects invalid enum values', () => {
    expect(() =>
      vantaQueryBodySchema.parse({
        operation: 'vanta_list_vulnerabilities',
        ...credentials,
        severity: 'SEVERE',
      })
    ).toThrow()
  })
})
