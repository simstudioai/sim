import type { OracleEpmClient, OracleEpmEndpoint } from '@/lib/internal/oracle-epm'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsRoutes } from '@/lib/internal/oracle-epm-fccs/routes'

interface FccsLink {
  rel: string
  href: string
  action?: string
}
interface FccsJobLinkContext {
  application: string
  jobId: string
  childJobId?: string
}

function assertJobLinkContext(href: string, expected: FccsJobLinkContext): void {
  /** The foundation has already validated this exact route and destination. */
  const path = new URL(href).pathname
  const marker = '/HyperionPlanning/rest/v3/applications/'
  const parts = path.slice(path.lastIndexOf(marker) + marker.length).split('/')
  if (
    decodeURIComponent(parts[0]) !== expected.application ||
    BigInt(parts[2]) !== BigInt(expected.jobId) ||
    (expected.childJobId !== undefined && BigInt(parts[4]) !== BigInt(expected.childJobId))
  )
    throw new Error('Oracle EPM FCCS returned a diagnostic link for a different job or application')
}
const childPolicy = fccsRoutes.defineReturnedLinkPolicy({
  relation: 'child-job-details',
  method: 'GET',
  endpoint: fccsEndpoints.getChildJobDetails,
  preserveGatewayBasePath: true,
})
const nextPolicies = new Map<
  OracleEpmEndpoint,
  ReturnType<typeof fccsRoutes.defineReturnedLinkPolicy>
>([
  [
    fccsEndpoints.getJobDetails,
    fccsRoutes.defineReturnedLinkPolicy({
      relation: 'next',
      method: 'GET',
      endpoint: fccsEndpoints.getJobDetails,
      preserveGatewayBasePath: true,
    }),
  ],
  [
    fccsEndpoints.getChildJobDetails,
    fccsRoutes.defineReturnedLinkPolicy({
      relation: 'next',
      method: 'GET',
      endpoint: fccsEndpoints.getChildJobDetails,
      preserveGatewayBasePath: true,
    }),
  ],
])

/** Validate provider links as foundation capabilities before exposing derived IDs or pagination. */
export function fccsChildJobId(
  client: OracleEpmClient,
  links: FccsLink[] | undefined,
  expected: FccsJobLinkContext
): string | undefined {
  const link = links?.find((candidate) => candidate.rel === 'child-job-details')
  if (!link) return undefined
  client.validateReturnedLink(childPolicy, { ...link, method: link.action })
  assertJobLinkContext(link.href, expected)
  const parts = new URL(link.href).pathname.split('/')
  return decodeURIComponent(parts[parts.length - 2])
}

export function fccsNextPage(
  client: OracleEpmClient,
  endpoint: OracleEpmEndpoint,
  links: FccsLink[] | undefined,
  expected: FccsJobLinkContext & { offset: number }
): { hasMore: boolean; nextOffset?: number } {
  const link = links?.find((candidate) => candidate.rel === 'next')
  if (!link) return { hasMore: false }
  const policy = nextPolicies.get(endpoint)
  if (!policy) throw new Error('Unsupported FCCS pagination endpoint')
  client.validateReturnedLink(policy, { ...link, method: link.action })
  assertJobLinkContext(link.href, expected)
  const offset = new URL(link.href).searchParams.get('offset')
  if (offset === null) throw new Error('Oracle EPM FCCS next-page link omitted its offset')
  if (Number(offset) <= expected.offset)
    throw new Error('Oracle EPM FCCS next-page link did not advance the offset')
  return { hasMore: true, nextOffset: Number(offset) }
}
