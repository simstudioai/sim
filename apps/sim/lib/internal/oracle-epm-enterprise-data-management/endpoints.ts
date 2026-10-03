import type { OracleEpmEndpointDeclaration } from '@/lib/internal/oracle-epm'
import {
  defineOracleEpmRouteSpace,
  oracleEpmLiteral,
  oracleEpmPathParameter,
  oracleEpmQuery,
} from '@/lib/internal/oracle-epm'

export const EDM_JSON_BYTES = 10 * 1024 * 1024
export const EDM_FILE_BYTES = 95 * 1024 * 1024
export const EDM_MULTIPART_BYTES = 100 * 1024 * 1024
export const EDM_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const edmRouteSpace = defineOracleEpmRouteSpace({
  context: ['epm', 'rest'],
  allowedVersions: ['v1'],
})

const textQuery = oracleEpmQuery.string({ maxBytes: 1024 })
const path = (template: string) =>
  template.split('/').map((part) =>
    part.startsWith(':')
      ? oracleEpmPathParameter(part.slice(1), {
          maxBytes: 255,
          ...(part === ':fileName'
            ? { mode: 'repository-path' as const }
            : part === ':location'
              ? {}
              : { pattern: EDM_UUID_PATTERN }),
        })
      : oracleEpmLiteral(part)
  )

function endpoint(
  template: string,
  options: Partial<Omit<OracleEpmEndpointDeclaration, 'path' | 'version'>> = {}
) {
  return edmRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: path(template),
    body: 'none',
    response: 'json',
    timeoutMs: 60_000,
    maxResponseBytes: EDM_JSON_BYTES,
    ...options,
  })
}

const post = (template: string) =>
  endpoint(template, { method: 'POST', body: 'json', maxRequestBytes: EDM_JSON_BYTES })
const upload = (template: string) =>
  endpoint(template, {
    method: 'POST',
    body: 'stream',
    maxRequestBytes: EDM_MULTIPART_BYTES,
    timeoutMs: 300_000,
    headers: { contentType: { name: 'Content-Type', required: true, maxBytes: 256 } },
  })
const viewpointPath = 'views/:viewId/viewpoints/:viewpointId'
const nodeQuery = {
  q: textQuery,
  expand: textQuery,
  limit: oracleEpmQuery.integer({ minimum: 1, maximum: 100 }),
  offset: oracleEpmQuery.integer({ minimum: 0, maximum: 1_000_000 }),
  fromId: textQuery,
  toId: textQuery,
  orderBy: textQuery,
}

/** Exact public v1 routes from Oracle's EDM REST endpoint catalog. */
export const edmEndpoints = {
  applications: endpoint('applications', { query: { q: textQuery } }),
  views: endpoint('views', { query: { q: textQuery } }),
  viewpoints: endpoint('views/:viewId/viewpoints', { query: { q: textQuery } }),
  nodes: endpoint(`${viewpointPath}/nodes`, { query: nodeQuery }),
  node: endpoint(`${viewpointPath}/nodes/:nodeId`, {
    query: { q: textQuery, expand: textQuery },
  }),
  nodeAtLocation: endpoint(`${viewpointPath}/nodes/:nodeId/locations/:location`, {
    query: { q: textQuery, expand: textQuery },
  }),
  createRequest: post('requests'),
  request: endpoint('requests/:requestId'),
  queryRequests: endpoint('requests/byName/query', {
    query: {
      lastDays: oracleEpmQuery.integer({ minimum: 1, maximum: 90 }),
      fromDate: oracleEpmQuery.integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      toDate: oracleEpmQuery.integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      expand: textQuery,
      myActivity: textQuery,
      owner: textQuery,
      priority: textQuery,
      requestNumber: textQuery,
      requestType: textQuery,
      stage: textQuery,
      status: textQuery,
      timeLabelName: textQuery,
      viewName: textQuery,
    },
  }),
  lineage: endpoint('requests/:requestId/lineage'),
  assignRequest: post('requests/assignRequest'),
  deleteRequest: endpoint('requests/:requestId', { method: 'DELETE', response: 'empty' }),
  uploadAttachment: upload('requests/:requestId/attachments/importFile'),
  generateAttachment: post('requests/:requestId/attachments/generate'),
  importAttachment: post('requests/:requestId/import'),
  transitionRequest: post('requests/:requestId/transitions'),
  job: endpoint('jobRuns/:jobRunId'),
  // Leave room for the job snapshot and output envelope under Sim's 10 MiB tool-response cap.
  jobResult: endpoint('jobRuns/:jobRunId/result', { maxResponseBytes: 8 * 1024 * 1024 }),
  validateViewpoint: post('viewpoints/validate/writeToFile'),
  mappingKeys: endpoint('dimensions/:dimensionId/bindings/:bindingId/mappingKeys'),
  exportMappings: post('dimensions/byName/exportMappings'),
  importDimension: post('dimensions/byName/import'),
  loadViewpoint: post('viewpoints/byName/load/file'),
  exportDimension: post('dimensions/byName/export'),
  incrementalExport: post('dimensions/byName/incrementalExport'),
  extractViewpoint: post('dimensions/byName/extract'),
  uploadStaging: upload('files/staging'),
  stagingFile: endpoint('files/staging/:fileName', {
    response: 'stream',
    maxResponseBytes: EDM_FILE_BYTES,
    timeoutMs: 300_000,
  }),
  temporaryFile: endpoint('files/temp/:fileId', {
    query: { fileName: textQuery },
    response: 'stream',
    maxResponseBytes: EDM_FILE_BYTES,
    timeoutMs: 300_000,
  }),
  attachmentReference: endpoint('requests/:requestId/attachments/:attachmentId'),
}
