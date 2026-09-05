import type { OracleEpmEndpointDeclaration } from '@/lib/internal/oracle-epm'
import {
  oracleEpmLiteral as literal,
  oracleEpmQuery,
  oracleEpmPathParameter as parameter,
} from '@/lib/internal/oracle-epm'
import { fccsFileRoutes, fccsRoutes } from '@/lib/internal/oracle-epm-fccs/routes'

export const FCCS_FILE_LIMIT = 100 * 1024 * 1024
export const FCCS_JSON_LIMIT = 8 * 1024 * 1024
export const FCCS_HIERARCHY_LIMIT = 2 * 1024 * 1024
export const fccsPageQuery = {
  offset: oracleEpmQuery.integer({ minimum: 0, maximum: 2_147_483_647 }),
  limit: oracleEpmQuery.integer({ minimum: 1, maximum: 1000 }),
}
const query = oracleEpmQuery.string({ maxBytes: 4096 })
const app = [literal('applications'), parameter('application', { maxBytes: 255 })]
const cube = [...app, literal('plantypes'), parameter('cube', { maxBytes: 255 })]
const dimension = parameter('dimension', { maxBytes: 255 })
const job = [...app, literal('jobs'), parameter('jobId', { maxBytes: 20, pattern: /^[0-9]+$/ })]
const filePath = [
  literal('applicationsnapshots'),
  parameter('fileName', { maxBytes: 255, mode: 'repository-path' }),
  literal('contents'),
]

function endpoint(
  path: OracleEpmEndpointDeclaration['path'],
  options: Partial<Omit<OracleEpmEndpointDeclaration, 'path' | 'version'>> = {}
) {
  const body = options.body ?? 'none'
  return fccsRoutes.defineEndpoint({
    method: 'GET',
    version: 'v3',
    path,
    body,
    response: 'json',
    timeoutMs: 60_000,
    maxResponseBytes: FCCS_JSON_LIMIT,
    ...(body === 'none' ? {} : { maxRequestBytes: FCCS_JSON_LIMIT }),
    ...options,
  })
}

/** Contracts: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/toc.htm */
export const fccsEndpoints = {
  listApplications: endpoint([literal('applications')]),
  listCubes: endpoint([...app, literal('plantypes')]),
  listDimensions: endpoint([...cube, literal('dimensions')], {
    query: { ...fccsPageQuery, q: query, fields: query },
  }),
  getDimension: endpoint([...cube, literal('dimensions'), dimension], {
    query: { fields: query, aliasTableName: query },
    maxResponseBytes: FCCS_HIERARCHY_LIMIT,
  }),
  getMember: endpoint([
    ...app,
    literal('dimensions'),
    dimension,
    literal('members'),
    parameter('member', { maxBytes: 255 }),
  ]),
  addMember: endpoint([...app, literal('dimensions'), dimension, literal('members')], {
    method: 'POST',
    body: 'json',
  }),
  validateMetadata: endpoint([...app, literal('application'), literal('validatemetadata')], {
    method: 'POST',
    query: { logFileName: oracleEpmQuery.string({ maxBytes: 255 }) },
  }),
  listJobDefinitions: endpoint([...app, literal('jobdefinitions')], { query: { q: query } }),
  executeJob: endpoint([...app, literal('jobs')], { method: 'POST', body: 'json' }),
  getJob: endpoint(job),
  getJobDetails: endpoint([...job, literal('details')], { query: { ...fccsPageQuery, q: query } }),
  getChildJobDetails: endpoint(
    [
      ...job,
      literal('childjobs'),
      parameter('childJobId', { maxBytes: 20, pattern: /^[0-9]+$/ }),
      literal('details'),
    ],
    { query: { ...fccsPageQuery, q: query } }
  ),
  exportDataSlice: endpoint([...cube, literal('exportdataslice')], {
    method: 'POST',
    body: 'json',
  }),
  importDataSlice: endpoint([...cube, literal('importdataslice')], {
    method: 'POST',
    body: 'json',
  }),
  clearDataSlice: endpoint([...cube, literal('cleardataslice')], { method: 'POST', body: 'json' }),
  listJournals: endpoint([...app, literal('journals')], { query: { ...fccsPageQuery, q: query } }),
  performJournalAction: endpoint(
    [...app, literal('journals'), parameter('journalLabel', { maxBytes: 255 }), literal('actions')],
    { method: 'POST', body: 'json' }
  ),
  updateJournalPeriod: endpoint(
    [...app, literal('journalPeriods'), parameter('period', { maxBytes: 255 }), literal('actions')],
    { method: 'POST', body: 'json' }
  ),
  exportConsolidationRulesets: endpoint([...app, literal('exportConfigConsolRules')], {
    method: 'POST',
    body: 'json',
    response: 'stream',
    maxResponseBytes: 64 * 1024,
  }),
  importConsolidationRulesets: endpoint([...app, literal('importConfigConsolRules')], {
    method: 'POST',
    body: 'json',
    response: 'stream',
    maxResponseBytes: 64 * 1024,
  }),
  listFiles: fccsFileRoutes.defineEndpoint({
    method: 'GET',
    version: 'v2',
    path: [literal('files'), literal('list')],
    body: 'none',
    response: 'json',
    timeoutMs: 60_000,
    maxResponseBytes: FCCS_JSON_LIMIT,
  }),
  uploadFile: fccsFileRoutes.defineEndpoint({
    method: 'POST',
    version: '11.1.2.3.600',
    path: filePath,
    query: { extDirPath: oracleEpmQuery.string({ maxBytes: 255 }) },
    body: 'stream',
    response: 'json',
    timeoutMs: 300_000,
    maxRequestBytes: FCCS_FILE_LIMIT,
    maxResponseBytes: 64 * 1024,
  }),
  downloadFile: fccsFileRoutes.defineEndpoint({
    method: 'GET',
    version: '11.1.2.3.600',
    path: filePath,
    body: 'none',
    response: 'stream',
    timeoutMs: 300_000,
    maxResponseBytes: FCCS_FILE_LIMIT,
  }),
  deleteFile: fccsFileRoutes.defineEndpoint({
    method: 'POST',
    version: 'v3',
    path: [literal('files'), literal('delete')],
    body: 'json',
    response: 'json',
    timeoutMs: 60_000,
    maxRequestBytes: 1024,
    maxResponseBytes: 64 * 1024,
  }),
}
