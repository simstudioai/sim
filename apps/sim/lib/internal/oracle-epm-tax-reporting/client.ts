import {
  createOracleEpmClient,
  defineOracleEpmRouteSpace,
  oracleEpmLiteral as literal,
  oracleEpmPathParameter as parameter,
} from '@/lib/internal/oracle-epm'
import type {
  OracleEpmEndpointDeclaration,
  OracleEpmPathPart,
  OracleEpmRouteSpace,
} from '@/lib/internal/oracle-epm/types'

/** Product-owned limits; requests never retry a potentially accepted mutation. */
export const TAX_JSON_BYTES = 2 * 1024 * 1024
export const TAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const TAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
export const TAX_MAX_ITEMS = 1000

const planning = defineOracleEpmRouteSpace({
  context: ['HyperionPlanning', 'rest'],
  allowedVersions: ['v3'],
})
const supplemental = defineOracleEpmRouteSpace({
  context: ['HyperionPlanning', 'rest', 'sdm'],
  allowedVersions: ['v1'],
})
const reports = defineOracleEpmRouteSpace({
  context: ['HyperionPlanning', 'rest', 'fcmapi'],
  allowedVersions: ['v1'],
})
// Oracle documents this standalone route separately from generated reports' status links.
const reportStatus = defineOracleEpmRouteSpace({
  context: ['arm', 'rest', 'fcmapi'],
  allowedVersions: ['v1'],
})
const files = defineOracleEpmRouteSpace({
  context: ['interop', 'rest'],
  allowedVersions: ['v2', '11.1.2.3.600'],
})

const name = (key: string) => parameter(key, { maxBytes: 255 })
const id = (key: string) => parameter(key, { maxBytes: 32, pattern: /^[0-9]+$/ })
const application = [literal('applications'), name('application')]
const jobs = [...application, literal('jobs')]
const fcmJobs = [...application, literal('fcmjobs')]
const members = [...application, literal('dimensions'), name('dimension'), literal('members')]
const cube = [...application, literal('plantypes'), name('planType')]
const repositoryFile = [
  literal('applicationsnapshots'),
  parameter('fileName', { maxBytes: 255, mode: 'repository-path' }),
  literal('contents'),
]
const detailQuery = {
  q: { kind: 'string' as const, maxBytes: 256 },
  offset: { kind: 'integer' as const, minimum: 0, maximum: 100000 },
  limit: { kind: 'integer' as const, minimum: 1, maximum: 100 },
}

function endpoint(
  space: OracleEpmRouteSpace,
  path: readonly OracleEpmPathPart[],
  options: Partial<OracleEpmEndpointDeclaration> = {}
) {
  return space.defineEndpoint({
    method: 'GET',
    version: space.allowedVersions[0],
    path,
    body: 'none',
    response: 'json',
    timeoutMs: 30000,
    maxResponseBytes: TAX_JSON_BYTES,
    ...options,
  })
}
const jsonPost = { method: 'POST' as const, body: 'json' as const, maxRequestBytes: TAX_JSON_BYTES }

/** Exact resources from Oracle's Tax Reporting applicability table and linked API references. */
export const taxEndpoints = {
  get_api_version: endpoint(planning, []),
  list_applications: endpoint(planning, [literal('applications')]),
  list_job_definitions: endpoint(planning, [...application, literal('jobdefinitions')], {
    query: { q: { kind: 'string', maxBytes: 256 } },
  }),
  get_member: endpoint(planning, [...members, name('memberName')]),
  add_member: endpoint(planning, members, jsonPost),
  export_data_slice: endpoint(planning, [...cube, literal('exportdataslice')], jsonPost),
  import_data_slice: endpoint(planning, [...cube, literal('importdataslice')], jsonPost),
  clear_data_slice: endpoint(planning, [...cube, literal('cleardataslice')], jsonPost),
  submit_job: endpoint(planning, jobs, jsonPost),
  get_job_status: endpoint(planning, [...jobs, id('jobId')]),
  get_job_details: endpoint(planning, [...jobs, id('jobId'), literal('details')], {
    query: detailQuery,
  }),
  get_child_job_details: endpoint(
    planning,
    [...jobs, id('jobId'), literal('childjobs'), id('childJobId'), literal('details')],
    { query: detailQuery }
  ),
  submit_fcm_job: endpoint(planning, fcmJobs, jsonPost),
  get_fcm_job: endpoint(planning, [...fcmJobs, id('jobId')]),
  submit_sdm_job: endpoint(supplemental, [literal('jobs')], jsonPost),
  get_sdm_job: endpoint(supplemental, [literal('jobs'), id('jobId')]),
  generate_report: endpoint(reports, [literal('report')], jsonPost),
  generate_user_details_report: endpoint(
    reports,
    [literal('fcm'), literal('export'), literal('users')],
    jsonPost
  ),
  get_report_status: endpoint(reportStatus, [
    literal('job'),
    parameter('module', { maxBytes: 4, pattern: /^(FCCS|SDM)$/ }),
    id('jobId'),
  ]),
  get_generated_report_status: endpoint(reports, [
    literal('report'),
    literal('job'),
    parameter('module', { maxBytes: 4, pattern: /^(FCCS|SDM)$/ }),
    id('jobId'),
  ]),
  get_user_report_status: endpoint(reports, [literal('fcm'), literal('job'), id('jobId')]),
  list_files: endpoint(files, [literal('files'), literal('list')]),
  upload_file: endpoint(files, repositoryFile, {
    version: '11.1.2.3.600',
    method: 'POST',
    body: 'stream',
    maxRequestBytes: TAX_UPLOAD_BYTES,
    query: {
      extDirPath: { kind: 'string', maxBytes: 255, pattern: /^(inbox|outbox)(\/[^/\\]+)*$/ },
    },
  }),
  download_file: endpoint(files, repositoryFile, {
    version: '11.1.2.3.600',
    response: 'stream',
    maxResponseBytes: TAX_DOWNLOAD_BYTES,
  }),
}

/** Only these documented returned relationships can be followed with credentials. */
export const taxLinkPolicies = {
  reportJob: reports.defineReturnedLinkPolicy({
    relation: 'Job Status',
    method: 'GET',
    endpoint: taxEndpoints.get_generated_report_status,
    preserveGatewayBasePath: true,
  }),
  userReportJob: reports.defineReturnedLinkPolicy({
    relation: 'Job Status',
    method: 'GET',
    endpoint: taxEndpoints.get_user_report_status,
    preserveGatewayBasePath: true,
  }),
  repositoryReport: files.defineReturnedLinkPolicy({
    relation: 'report-content',
    method: 'GET',
    endpoint: taxEndpoints.download_file,
    preserveGatewayBasePath: true,
  }),
  generatedReport: reports.defineReturnedLinkPolicy({
    relation: 'report-content',
    method: 'GET',
    version: 'v1',
    path: [name('fileName')],
    response: 'stream',
    timeoutMs: 30000,
    maxResponseBytes: TAX_DOWNLOAD_BYTES,
    preserveGatewayBasePath: true,
  }),
}

/** Credentials are injected by Sim, never taken from a model-visible destination input. */
export const createTaxReportingClient = createOracleEpmClient
