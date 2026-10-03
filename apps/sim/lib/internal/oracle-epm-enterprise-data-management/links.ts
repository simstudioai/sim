import type { OracleEpmClient, OracleEpmValidatedLink } from '@/lib/internal/oracle-epm'
import {
  edmEndpoints,
  edmRouteSpace,
} from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import { edmLinkEnvelopeSchema } from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'
import { EdmOperationError } from '@/lib/internal/oracle-epm-enterprise-data-management/types'

const policies = {
  job: edmRouteSpace.defineReturnedLinkPolicy({
    relation: 'results',
    method: 'GET',
    endpoint: edmEndpoints.job,
    preserveGatewayBasePath: true,
  }),
  attachment: edmRouteSpace.defineReturnedLinkPolicy({
    relation: 'attachment',
    method: 'GET',
    endpoint: edmEndpoints.attachmentReference,
    preserveGatewayBasePath: true,
  }),
  staging: edmRouteSpace.defineReturnedLinkPolicy({
    relation: 'file',
    method: 'GET',
    endpoint: edmEndpoints.stagingFile,
    preserveGatewayBasePath: true,
  }),
  stagingResult: edmRouteSpace.defineReturnedLinkPolicy({
    relation: 'results',
    method: 'GET',
    endpoint: edmEndpoints.stagingFile,
    preserveGatewayBasePath: true,
  }),
  temporaryResult: edmRouteSpace.defineReturnedLinkPolicy({
    relation: 'results',
    method: 'GET',
    endpoint: edmEndpoints.temporaryFile,
    preserveGatewayBasePath: true,
  }),
  jsonResult: edmRouteSpace.defineReturnedLinkPolicy({
    relation: 'results',
    method: 'GET',
    endpoint: edmEndpoints.jobResult,
    preserveGatewayBasePath: true,
  }),
}

function requireLink(data: unknown, relation: string) {
  const matches = edmLinkEnvelopeSchema.parse(data).links.filter((link) => link.rel === relation)
  if (matches.length !== 1)
    throw new EdmOperationError('Oracle EDM did not return one expected workflow link', 502)
  return matches[0]
}

/** Validate first; URL parsing below only extracts identifiers from the admitted route. */
export function edmJobLink(client: OracleEpmClient, data: unknown) {
  const link = requireLink(data, 'results')
  const handle = client.validateReturnedLink(policies.job, link)
  const id = new URL(link.href).pathname.split('/').at(-1)
  if (!id) throw new EdmOperationError('Oracle EDM did not return a job identifier', 502)
  return { id: decodeURIComponent(id), handle }
}

export function edmAttachmentLink(client: OracleEpmClient, data: unknown, requestId: string) {
  const link = requireLink(data, 'attachment')
  client.validateReturnedLink(policies.attachment, link)
  const segments = new URL(link.href).pathname.split('/').map(decodeURIComponent)
  if (segments.at(-3)?.toLowerCase() !== requestId.toLowerCase()) {
    throw new EdmOperationError('Oracle EDM returned an attachment for a different request', 502)
  }
  return { attachmentId: segments.at(-1)!, attachmentUri: link.href }
}

export function validateEdmStagingLink(client: OracleEpmClient, data: unknown, fileName: string) {
  const link = requireLink(data, 'file')
  client.validateReturnedLink(policies.staging, link)
  if (decodeURIComponent(new URL(link.href).pathname.split('/').at(-1)!) !== fileName) {
    throw new EdmOperationError('Oracle EDM returned a different staging file', 502)
  }
}

export function edmDownloadLink(
  client: OracleEpmClient,
  data: unknown
): {
  handle: OracleEpmValidatedLink
  fileName: string
} | null {
  const links = edmLinkEnvelopeSchema.parse(data).links.filter((link) => link.rel === 'results')
  if (links.length === 0) return null
  if (links.length !== 1)
    throw new EdmOperationError('Oracle EDM returned ambiguous result links', 502)
  const link = links[0]
  for (const policy of [policies.temporaryResult, policies.stagingResult]) {
    try {
      const handle = client.validateReturnedLink(policy, link)
      const url = new URL(link.href)
      return {
        handle,
        fileName:
          url.searchParams.get('fileName') ?? decodeURIComponent(url.pathname.split('/').at(-1)!),
      }
    } catch {
      /** A result relation may denote either documented file route; neither permits arbitrary URLs. */
    }
  }
  try {
    // A JSON result is not a file. By-name workflows download their explicitly named staging file.
    client.validateReturnedLink(policies.jsonResult, link)
    return null
  } catch {
    throw new EdmOperationError('Oracle EDM returned an unsupported result file link', 502)
  }
}
