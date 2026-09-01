import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import {
  isPayloadSizeLimitError,
  readResponseJsonWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  fetchVantaWithAuth,
  getVantaBaseUrl,
  VANTA_DOCUMENT_UPLOAD_SCOPE,
  VANTA_READ_SCOPE,
  VANTA_WRITE_SCOPE,
} from '@/lib/internal/vanta/client'
import { VantaOperationError } from '@/lib/internal/vanta/errors'
import { resolveVantaUploadFile } from '@/lib/internal/vanta/file-input'
import {
  VANTA_MAX_TRANSFER_BYTES,
  type VantaDownloadDocumentFileInput,
  type VantaUploadDocumentFileInput,
} from '@/lib/internal/vanta/input'
import {
  asVantaRecord,
  buildVantaUrl,
  extractVantaError,
  getVantaListResults,
  normalizeVantaControl,
  normalizeVantaControlDetail,
  normalizeVantaDocument,
  normalizeVantaDocumentDetail,
  normalizeVantaFramework,
  normalizeVantaFrameworkDetail,
  normalizeVantaMonitoredComputer,
  normalizeVantaPerson,
  normalizeVantaPolicy,
  normalizeVantaRiskScenario,
  normalizeVantaTest,
  normalizeVantaTestEntity,
  normalizeVantaUploadedFile,
  normalizeVantaVendor,
  normalizeVantaVulnerability,
  normalizeVantaVulnerabilityRemediation,
  normalizeVantaVulnerableAsset,
  splitVantaCommaList,
} from '@/lib/internal/vanta/normalizers'
import type { VantaQueryBody } from '@/lib/internal/vanta/schema'

interface VantaFileOperationContext {
  requestId: string
  signal?: AbortSignal
  userId: string
}

function downloadSizeError(bytes?: number): VantaOperationError {
  return new VantaOperationError(400, {
    success: false,
    error:
      bytes === undefined
        ? 'File exceeds download limit of 100MB'
        : `File size (${(bytes / (1024 * 1024)).toFixed(2)}MB) exceeds download limit of 100MB`,
  })
}

function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return null
    }
  }
  return header.match(/filename="?([^";]+)"?/i)?.[1] ?? null
}

async function readVantaJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  return readResponseJsonWithLimit<unknown>(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Vanta API response',
    signal,
  }).catch(() => null)
}

interface VantaApiRequest {
  method: 'GET' | 'POST'
  url: string
}

/**
 * Maps a validated query operation to the Vanta API request it performs.
 */
function buildVantaApiRequest(baseUrl: string, params: VantaQueryBody): VantaApiRequest {
  const id = encodeURIComponent

  switch (params.operation) {
    case 'vanta_list_frameworks':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/frameworks', {
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_get_framework':
      return { method: 'GET', url: buildVantaUrl(baseUrl, `/frameworks/${id(params.frameworkId)}`) }
    case 'vanta_list_framework_controls':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, `/frameworks/${id(params.frameworkId)}/controls`, {
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_list_controls':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/controls', {
          frameworkMatchesAny: splitVantaCommaList(params.frameworkMatchesAny),
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_get_control':
      return { method: 'GET', url: buildVantaUrl(baseUrl, `/controls/${id(params.controlId)}`) }
    case 'vanta_list_control_tests':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, `/controls/${id(params.controlId)}/tests`, {
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_list_control_documents':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, `/controls/${id(params.controlId)}/documents`, {
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_list_tests':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/tests', {
          statusFilter: params.statusFilter,
          frameworkFilter: params.frameworkFilter,
          integrationFilter: params.integrationFilter,
          controlFilter: params.controlFilter,
          ownerFilter: params.ownerFilter,
          categoryFilter: params.categoryFilter,
          isInRollout: params.isInRollout,
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_get_test':
      return { method: 'GET', url: buildVantaUrl(baseUrl, `/tests/${id(params.testId)}`) }
    case 'vanta_list_test_entities':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, `/tests/${id(params.testId)}/entities`, {
          entityStatus: params.entityStatus,
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_list_documents':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/documents', {
          frameworkMatchesAny: splitVantaCommaList(params.frameworkMatchesAny),
          statusMatchesAny: splitVantaCommaList(params.statusMatchesAny),
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_get_document':
      return { method: 'GET', url: buildVantaUrl(baseUrl, `/documents/${id(params.documentId)}`) }
    case 'vanta_list_document_uploads':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, `/documents/${id(params.documentId)}/uploads`, {
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_submit_document':
      return {
        method: 'POST',
        url: buildVantaUrl(baseUrl, `/documents/${id(params.documentId)}/submit`),
      }
    case 'vanta_list_people':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/people', {
          emailAndNameFilter: params.emailAndNameFilter,
          employmentStatus: params.employmentStatus,
          groupIdsMatchesAny: splitVantaCommaList(params.groupIdsMatchesAny),
          tasksSummaryStatusMatchesAny: splitVantaCommaList(params.tasksSummaryStatusMatchesAny),
          taskTypeMatchesAny: splitVantaCommaList(params.taskTypeMatchesAny),
          taskStatusMatchesAny: splitVantaCommaList(params.taskStatusMatchesAny),
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_get_person':
      return { method: 'GET', url: buildVantaUrl(baseUrl, `/people/${id(params.personId)}`) }
    case 'vanta_list_policies':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/policies', {
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_get_policy':
      return { method: 'GET', url: buildVantaUrl(baseUrl, `/policies/${id(params.policyId)}`) }
    case 'vanta_list_vendors':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/vendors', {
          name: params.name,
          statusMatchesAny: splitVantaCommaList(params.statusMatchesAny),
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_get_vendor':
      return { method: 'GET', url: buildVantaUrl(baseUrl, `/vendors/${id(params.vendorId)}`) }
    case 'vanta_list_monitored_computers':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/monitored-computers', {
          complianceStatusFilterMatchesAny: splitVantaCommaList(
            params.complianceStatusFilterMatchesAny
          ),
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_list_vulnerabilities':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/vulnerabilities', {
          q: params.q,
          severity: params.severity,
          isFixAvailable: params.isFixAvailable,
          isDeactivated: params.isDeactivated,
          includeVulnerabilitiesWithoutSlas: params.includeVulnerabilitiesWithoutSlas,
          packageIdentifier: params.packageIdentifier,
          externalVulnerabilityId: params.externalVulnerabilityId,
          integrationId: params.integrationId,
          vulnerableAssetId: params.vulnerableAssetId,
          slaDeadlineAfterDate: params.slaDeadlineAfterDate,
          slaDeadlineBeforeDate: params.slaDeadlineBeforeDate,
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_list_vulnerability_remediations':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/vulnerability-remediations', {
          integrationId: params.integrationId,
          severity: params.severity,
          isRemediatedOnTime: params.isRemediatedOnTime,
          remediatedAfterDate: params.remediatedAfterDate,
          remediatedBeforeDate: params.remediatedBeforeDate,
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_list_vulnerable_assets':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/vulnerable-assets', {
          q: params.q,
          integrationId: params.integrationId,
          assetType: params.assetType,
          assetExternalAccountId: params.assetExternalAccountId,
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_get_vulnerable_asset':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, `/vulnerable-assets/${id(params.vulnerableAssetId)}`),
      }
    case 'vanta_list_risk_scenarios':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, '/risk-scenarios', {
          searchString: params.searchString,
          includeIgnored: params.includeIgnored,
          type: params.type,
          ownerMatchesAny: splitVantaCommaList(params.ownerMatchesAny),
          categoryMatchesAny: splitVantaCommaList(params.categoryMatchesAny),
          ciaCategoryMatchesAny: splitVantaCommaList(params.ciaCategoryMatchesAny),
          treatmentTypeMatchesAny: splitVantaCommaList(params.treatmentTypeMatchesAny),
          inherentScoreGroupMatchesAny: splitVantaCommaList(params.inherentScoreGroupMatchesAny),
          residualScoreGroupMatchesAny: splitVantaCommaList(params.residualScoreGroupMatchesAny),
          reviewStatusMatchesAny: splitVantaCommaList(params.reviewStatusMatchesAny),
          orderBy: params.orderBy,
          pageSize: params.pageSize,
          pageCursor: params.pageCursor,
        }),
      }
    case 'vanta_get_risk_scenario':
      return {
        method: 'GET',
        url: buildVantaUrl(baseUrl, `/risk-scenarios/${id(params.riskScenarioId)}`),
      }
  }
}

/**
 * Normalizes a successful Vanta API response body into the operation's
 * documented output shape.
 */
function buildVantaOutput(params: VantaQueryBody, data: unknown): Record<string, unknown> {
  switch (params.operation) {
    case 'vanta_list_frameworks': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { frameworks: items.map(normalizeVantaFramework), pageInfo }
    }
    case 'vanta_get_framework':
      return { framework: normalizeVantaFrameworkDetail(asVantaRecord(data)) }
    case 'vanta_list_framework_controls':
    case 'vanta_list_controls': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { controls: items.map(normalizeVantaControl), pageInfo }
    }
    case 'vanta_get_control':
      return { control: normalizeVantaControlDetail(asVantaRecord(data)) }
    case 'vanta_list_control_tests':
    case 'vanta_list_tests': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { tests: items.map(normalizeVantaTest), pageInfo }
    }
    case 'vanta_get_test':
      return { test: normalizeVantaTest(asVantaRecord(data)) }
    case 'vanta_list_test_entities': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { entities: items.map(normalizeVantaTestEntity), pageInfo }
    }
    case 'vanta_list_control_documents':
    case 'vanta_list_documents': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { documents: items.map(normalizeVantaDocument), pageInfo }
    }
    case 'vanta_get_document':
      return { document: normalizeVantaDocumentDetail(asVantaRecord(data)) }
    case 'vanta_list_document_uploads': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { uploads: items.map(normalizeVantaUploadedFile), pageInfo }
    }
    case 'vanta_submit_document':
      return { documentId: params.documentId, submitted: true }
    case 'vanta_list_people': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { people: items.map(normalizeVantaPerson), pageInfo }
    }
    case 'vanta_get_person':
      return { person: normalizeVantaPerson(asVantaRecord(data)) }
    case 'vanta_list_policies': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { policies: items.map(normalizeVantaPolicy), pageInfo }
    }
    case 'vanta_get_policy':
      return { policy: normalizeVantaPolicy(asVantaRecord(data)) }
    case 'vanta_list_vendors': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { vendors: items.map(normalizeVantaVendor), pageInfo }
    }
    case 'vanta_get_vendor':
      return { vendor: normalizeVantaVendor(asVantaRecord(data)) }
    case 'vanta_list_monitored_computers': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { computers: items.map(normalizeVantaMonitoredComputer), pageInfo }
    }
    case 'vanta_list_vulnerabilities': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { vulnerabilities: items.map(normalizeVantaVulnerability), pageInfo }
    }
    case 'vanta_list_vulnerability_remediations': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { remediations: items.map(normalizeVantaVulnerabilityRemediation), pageInfo }
    }
    case 'vanta_list_vulnerable_assets': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { assets: items.map(normalizeVantaVulnerableAsset), pageInfo }
    }
    case 'vanta_get_vulnerable_asset':
      return { asset: normalizeVantaVulnerableAsset(asVantaRecord(data)) }
    case 'vanta_list_risk_scenarios': {
      const { data: items, pageInfo } = getVantaListResults(data)
      return { riskScenarios: items.map(normalizeVantaRiskScenario), pageInfo }
    }
    case 'vanta_get_risk_scenario':
      return { riskScenario: normalizeVantaRiskScenario(asVantaRecord(data)) }
  }
}

export type VantaQueryResult =
  | { success: true; output: Record<string, unknown> }
  | { success: false; error: string; status: number }

/** Executes one canonical Vanta query directly against the provider. */
export async function executeVantaQuery(
  params: VantaQueryBody,
  signal?: AbortSignal
): Promise<VantaQueryResult> {
  signal?.throwIfAborted()
  const baseUrl = getVantaBaseUrl(params.region)
  const scope = params.operation === 'vanta_submit_document' ? VANTA_WRITE_SCOPE : VANTA_READ_SCOPE
  const apiRequest = buildVantaApiRequest(baseUrl, params)
  const response = await fetchVantaWithAuth(
    {
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
      scope,
    },
    (accessToken) =>
      fetch(apiRequest.url, {
        method: apiRequest.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
        signal,
      }),
    { signal }
  )
  signal?.throwIfAborted()

  const data =
    response.status === 204
      ? null
      : await readResponseJsonWithLimit<unknown>(response, {
          maxBytes: MAX_JSON_API_RESPONSE_BYTES,
          label: 'Vanta API response',
          signal,
        }).catch(() => null)
  signal?.throwIfAborted()

  if (!response.ok) {
    return {
      success: false,
      error: extractVantaError(data, 'Vanta request failed'),
      status: response.status,
    }
  }
  return { success: true, output: buildVantaOutput(params, data) }
}

export async function executeVantaUploadDocumentFile(
  input: VantaUploadDocumentFileInput,
  context: VantaFileOperationContext
): Promise<Record<string, unknown>> {
  context.signal?.throwIfAborted()
  const file = await resolveVantaUploadFile(input, context)
  context.signal?.throwIfAborted()
  const uploadUrl = buildVantaUrl(
    getVantaBaseUrl(input.region),
    `/documents/${encodeURIComponent(input.documentId)}/uploads`
  )
  const response = await fetchVantaWithAuth(
    {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      region: input.region,
      scope: VANTA_DOCUMENT_UPLOAD_SCOPE,
    },
    (accessToken) => {
      const formData = new FormData()
      formData.append(
        'file',
        new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
        file.fileName
      )
      if (input.description) formData.append('description', input.description)
      if (input.effectiveAtDate) formData.append('effectiveAtDate', input.effectiveAtDate)
      return fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
        cache: 'no-store',
        signal: context.signal,
      })
    },
    { signal: context.signal }
  )
  context.signal?.throwIfAborted()
  const data = await readVantaJson(response, context.signal)
  context.signal?.throwIfAborted()
  if (!response.ok) {
    throw new VantaOperationError(response.status, {
      success: false,
      error: extractVantaError(data, 'Failed to upload file to Vanta document'),
    })
  }
  return {
    success: true,
    output: { upload: normalizeVantaUploadedFile(asVantaRecord(data)) },
  }
}

export async function executeVantaDownloadDocumentFile(
  input: VantaDownloadDocumentFileInput,
  context: VantaFileOperationContext
): Promise<Record<string, unknown>> {
  context.signal?.throwIfAborted()
  const mediaUrl = buildVantaUrl(
    getVantaBaseUrl(input.region),
    `/documents/${encodeURIComponent(input.documentId)}/uploads/${encodeURIComponent(input.uploadedFileId)}/media`
  )
  const response = await fetchVantaWithAuth(
    {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      region: input.region,
      scope: VANTA_READ_SCOPE,
    },
    (accessToken) =>
      fetch(mediaUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
        signal: context.signal,
      }),
    { signal: context.signal }
  )
  context.signal?.throwIfAborted()
  if (!response.ok) {
    const errorData = await readVantaJson(response, context.signal)
    throw new VantaOperationError(response.status, {
      success: false,
      error: extractVantaError(errorData, 'Failed to download Vanta document file'),
    })
  }

  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader)
  const knownContentLength =
    contentLength !== undefined && Number.isFinite(contentLength) ? contentLength : undefined
  let buffer: Buffer
  try {
    buffer = await readResponseToBufferWithLimit(response, {
      maxBytes: VANTA_MAX_TRANSFER_BYTES,
      label: 'Vanta document file',
      signal: context.signal,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error)) {
      throw downloadSizeError(knownContentLength)
    }
    throw error
  }
  context.signal?.throwIfAborted()
  const mimeType = response.headers.get('content-type') || 'application/octet-stream'
  const name =
    fileNameFromContentDisposition(response.headers.get('content-disposition')) ||
    `vanta-document-file-${input.uploadedFileId}`
  return {
    success: true,
    output: {
      file: { name, mimeType, data: buffer.toString('base64'), size: buffer.length },
      name,
      mimeType,
      size: buffer.length,
    },
  }
}
