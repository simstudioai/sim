import {
  defineOracleEpmRouteSpace,
  oracleEpmLiteral as literal,
  oracleEpmQuery,
  oracleEpmPathParameter as parameter,
} from '@/lib/internal/oracle-epm'

export const ARCS_MAX_FILE_BYTES = 100 * 1024 * 1024
export const ARCS_MAX_JSON_BYTES = 10 * 1024 * 1024
const read = {
  body: 'none',
  response: 'json',
  timeoutMs: 30_000,
  maxResponseBytes: ARCS_MAX_JSON_BYTES,
} as const
const write = {
  body: 'json',
  response: 'json',
  timeoutMs: 60_000,
  maxRequestBytes: 1024 * 1024,
  maxResponseBytes: ARCS_MAX_JSON_BYTES,
} as const
const download = {
  ...read,
  response: 'stream',
  timeoutMs: 60_000,
  maxResponseBytes: ARCS_MAX_FILE_BYTES,
} as const
const id = (name: string) => parameter(name, { maxBytes: 20, pattern: /^[0-9]{1,20}$/ })
const name = (key: string) => parameter(key, { maxBytes: 255 })
const repositoryFile = parameter('fileName', { maxBytes: 255, mode: 'repository-path' })

const compliance = defineOracleEpmRouteSpace({
  context: ['armARCS', 'rest'],
  allowedVersions: ['v1'],
})
const matching = defineOracleEpmRouteSpace({ context: ['arm', 'rest'], allowedVersions: ['v1'] })
const periods = defineOracleEpmRouteSpace({ context: ['armARCS'], allowedVersions: ['rest'] })
const fcm = defineOracleEpmRouteSpace({
  context: ['arm', 'rest', 'fcmapi'],
  allowedVersions: ['v1'],
})
const security = defineOracleEpmRouteSpace({
  context: ['interop', 'rest', 'security'],
  allowedVersions: ['v1'],
})
const interop = defineOracleEpmRouteSpace({
  context: ['interop', 'rest'],
  allowedVersions: ['11.1.2.3.600', 'v3'],
})
const matchingArtifacts = defineOracleEpmRouteSpace({
  context: ['rest'],
  allowedVersions: ['applicationsnapshots'],
})

/** Product-owned routes from Oracle's Account Reconciliation and Interop REST contracts. */
export const arcsRoutes = {
  complianceJobs: compliance.defineEndpoint({
    ...write,
    method: 'POST',
    version: 'v1',
    path: [literal('jobs')],
  }),
  matchingJobs: matching.defineEndpoint({
    ...write,
    method: 'POST',
    version: 'v1',
    path: [literal('jobs')],
  }),
  complianceJob: compliance.defineEndpoint({
    ...read,
    method: 'GET',
    version: 'v1',
    path: [literal('jobs'), id('jobId')],
  }),
  matchingJob: matching.defineEndpoint({
    ...read,
    method: 'GET',
    version: 'v1',
    path: [literal('jobs'), id('jobId')],
  }),
  periods: periods.defineEndpoint({
    ...read,
    method: 'GET',
    version: 'rest',
    path: [literal('periods')],
    query: {
      status: oracleEpmQuery.string({
        required: true,
        maxBytes: 12,
        pattern: /^(ALL|OPEN|CLOSED|LOCKED|PENDING|OPEN_PENDING)$/,
      }),
    },
  }),
  comments: compliance.defineEndpoint({
    ...read,
    method: 'GET',
    version: 'v1',
    path: [
      literal('period'),
      name('period'),
      literal('reconciliation'),
      name('accountId'),
      literal('comments'),
    ],
  }),
  users: security.defineEndpoint({
    ...write,
    method: 'POST',
    version: 'v1',
    path: [literal('users'), literal('list')],
  }),
  report: fcm.defineEndpoint({
    ...write,
    method: 'POST',
    version: 'v1',
    path: [literal('rc'), literal('export'), literal('users')],
  }),
  reportJob: fcm.defineEndpoint({
    ...read,
    method: 'GET',
    version: 'v1',
    path: [literal('rc'), literal('job'), id('jobId')],
  }),
  attachment: fcm.defineEndpoint({
    ...download,
    method: 'GET',
    version: 'v1',
    path: [literal('rc'), literal('references'), id('referenceId'), literal('file')],
  }),
  listFiles: interop.defineEndpoint({
    ...read,
    method: 'GET',
    version: '11.1.2.3.600',
    path: [literal('applicationsnapshots')],
  }),
  uploadFile: interop.defineEndpoint({
    ...write,
    method: 'POST',
    version: '11.1.2.3.600',
    path: [literal('applicationsnapshots'), repositoryFile, literal('contents')],
    body: 'stream',
    maxRequestBytes: ARCS_MAX_FILE_BYTES,
    query: { extDirPath: oracleEpmQuery.string({ maxBytes: 255 }) },
  }),
  downloadFile: interop.defineEndpoint({
    ...download,
    method: 'GET',
    version: '11.1.2.3.600',
    path: [literal('applicationsnapshots'), repositoryFile, literal('contents')],
  }),
  deleteFile: interop.defineEndpoint({
    ...write,
    method: 'POST',
    version: 'v3',
    path: [literal('files'), literal('delete')],
  }),
}

export const arcsJobLinkPolicies = {
  compliance: {
    self: compliance.defineReturnedLinkPolicy({
      relation: 'self',
      method: 'GET',
      endpoint: arcsRoutes.complianceJob,
      preserveGatewayBasePath: true,
    }),
    'Job Status': compliance.defineReturnedLinkPolicy({
      relation: 'Job Status',
      method: 'GET',
      endpoint: arcsRoutes.complianceJob,
      preserveGatewayBasePath: true,
    }),
  },
  matching: {
    self: matching.defineReturnedLinkPolicy({
      relation: 'self',
      method: 'GET',
      endpoint: arcsRoutes.matchingJob,
      preserveGatewayBasePath: true,
    }),
    'Job Status': matching.defineReturnedLinkPolicy({
      relation: 'Job Status',
      method: 'GET',
      endpoint: arcsRoutes.matchingJob,
      preserveGatewayBasePath: true,
    }),
  },
  report: {
    self: fcm.defineReturnedLinkPolicy({
      relation: 'self',
      method: 'GET',
      endpoint: arcsRoutes.reportJob,
      preserveGatewayBasePath: true,
    }),
    'Job Status': fcm.defineReturnedLinkPolicy({
      relation: 'Job Status',
      method: 'GET',
      endpoint: arcsRoutes.reportJob,
      preserveGatewayBasePath: true,
    }),
  },
}

/** Download links are capabilities, never caller-supplied destinations. */
export const arcsArtifactPolicies = {
  'log-content': matchingArtifacts.defineReturnedLinkPolicy({
    ...download,
    relation: 'log-content',
    method: 'GET',
    version: 'applicationsnapshots',
    path: [repositoryFile, literal('contents')],
    preserveGatewayBasePath: true,
  }),
  'file-content': matchingArtifacts.defineReturnedLinkPolicy({
    ...download,
    relation: 'file-content',
    method: 'GET',
    version: 'applicationsnapshots',
    path: [repositoryFile, literal('contents')],
    preserveGatewayBasePath: true,
  }),
  'report-content': interop.defineReturnedLinkPolicy({
    relation: 'report-content',
    method: 'GET',
    endpoint: arcsRoutes.downloadFile,
    preserveGatewayBasePath: true,
  }),
  attachment: fcm.defineReturnedLinkPolicy({
    relation: 'attachment',
    method: 'GET',
    endpoint: arcsRoutes.attachment,
    preserveGatewayBasePath: true,
  }),
}
