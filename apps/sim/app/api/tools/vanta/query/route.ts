import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import type { VantaQueryBody } from '@/lib/api/contracts/tools/vanta'
import { vantaQueryContract } from '@/lib/api/contracts/tools/vanta'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  asVantaRecord,
  buildVantaUrl,
  extractVantaError,
  fetchVantaWithAuth,
  getVantaBaseUrl,
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
  VANTA_READ_SCOPE,
  VANTA_WRITE_SCOPE,
} from '@/tools/vanta/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('VantaQueryAPI')

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

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Vanta query attempt`, {
        error: authResult.error || 'Unauthorized',
      })
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(vantaQueryContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    const baseUrl = getVantaBaseUrl(params.region)
    const scope =
      params.operation === 'vanta_submit_document' ? VANTA_WRITE_SCOPE : VANTA_READ_SCOPE

    logger.info(`[${requestId}] Vanta query request`, { operation: params.operation })

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
        })
    )

    if (!response.ok) {
      const errorData: unknown = await response.json().catch(() => null)
      return NextResponse.json(
        { success: false, error: extractVantaError(errorData, 'Vanta request failed') },
        { status: response.status }
      )
    }

    const data: unknown = response.status === 204 ? null : await response.json().catch(() => null)
    return NextResponse.json({ success: true, output: buildVantaOutput(params, data) })
  } catch (error) {
    const message = toError(error).message
    logger.error(`[${requestId}] Vanta query failed`, { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
