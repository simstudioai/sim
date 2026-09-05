/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { getOracleEpmEndpoint } from '@/lib/internal/oracle-epm/endpoint'
import {
  NARRATIVE_MAX_DOWNLOAD_BYTES,
  NARRATIVE_MAX_MULTIPART_OVERHEAD_BYTES,
  NARRATIVE_MAX_SOURCE_BYTES,
  narrativeEndpoints,
  narrativeJobSelfPolicy,
  narrativeRouteSpace,
} from '@/lib/internal/oracle-epm-narrative-reporting/routes'

describe('Narrative Reporting endpoint policies', () => {
  it('separates JSON jobs from bodyless book rendering and bounded downloads', () => {
    expect(getOracleEpmEndpoint(narrativeEndpoints.submitJob)).toMatchObject({
      method: 'POST',
      body: 'json',
      response: 'json',
    })
    expect(getOracleEpmEndpoint(narrativeEndpoints.downloadBook)).toMatchObject({
      method: 'POST',
      body: 'none',
      response: 'stream',
      maxResponseBytes: 104_857_600,
    })
    expect(getOracleEpmEndpoint(narrativeEndpoints.deleteArtifact)).toMatchObject({
      method: 'DELETE',
      body: 'none',
      response: 'empty',
    })
    expect(narrativeRouteSpace.context).toEqual(['epm', 'rest'])
    expect(NARRATIVE_MAX_SOURCE_BYTES + NARRATIVE_MAX_MULTIPART_OVERHEAD_BYTES).toBe(
      NARRATIVE_MAX_DOWNLOAD_BYTES
    )
  })
  it('does not publish a speculative package or file endpoint policy', () => {
    expect(narrativeEndpoints).not.toHaveProperty('listReportPackages')
    expect(narrativeEndpoints).not.toHaveProperty('uploadFile')
  })
  it('uses the foundation for opaque self links and rejects other destinations or queries', () => {
    const client = createOracleEpmClient({
      instanceUrl: 'https://example.oraclecloud.com',
      accessToken: 'dXNlcjpwYXNz',
    })
    const href = 'https://example.oraclecloud.com/epm/rest/v1/jobs/job-1'
    const link = client.validateReturnedLink(narrativeJobSelfPolicy, { rel: 'self', href })
    expect(JSON.stringify(link)).toBe('{}')
    for (const invalid of [
      href.replace('example.oraclecloud.com', 'attacker.example'),
      `${href}?override=true`,
      href.replace('/jobs/', '/reports/'),
      href.replace('/epm/', '/epm\\\\'),
    ]) {
      expect(() =>
        client.validateReturnedLink(narrativeJobSelfPolicy, { rel: 'self', href: invalid })
      ).toThrow()
    }
    expect(() =>
      client.validateReturnedLink(narrativeJobSelfPolicy, { rel: 'exported/artifact', href })
    ).toThrow()
  })
})
