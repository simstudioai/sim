import {
  oracleEpmLiteral as literal,
  oracleEpmPathParameter as parameter,
} from '@/lib/internal/oracle-epm/endpoint'
import { defineOracleEpmRouteSpace } from '@/lib/internal/oracle-epm/route-space'
import type {
  OracleEpmEndpointDeclaration,
  OracleEpmPathPart,
} from '@/lib/internal/oracle-epm/types'

export const PLANNING_INLINE_BYTES = 16 * 1024 * 1024
export const PLANNING_DOWNLOAD_BYTES = 100 * 1024 * 1024
export const PLANNING_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
export const PLANNING_INPUT_FILE_BYTES = 5 * 1024 * 1024 * 1024

export const planningRouteSpace = defineOracleEpmRouteSpace({
  context: ['HyperionPlanning', 'rest'],
  allowedVersions: ['v3'],
})
export const planningInteropRouteSpace = defineOracleEpmRouteSpace({
  context: ['interop', 'rest'],
  allowedVersions: ['v1', 'v2'],
})

const name = (key: string) => parameter(key, { maxBytes: 255 })
const jobId = parameter('jobId', { maxBytes: 32, pattern: /^[0-9]+$/ })
const application = [literal('applications'), name('application')]
const cube = [...application, literal('plantypes'), name('cube')]
const variables = [...application, literal('substitutionvariables')]
const cubeVariables = [...cube, literal('substitutionvariables')]
const member = [...application, literal('dimensions'), name('dimension'), literal('members')]
const page = {
  offset: { kind: 'integer', minimum: 0, maximum: 1_000_000 },
  limit: { kind: 'integer', minimum: 1, maximum: 1000 },
} as const
const q = { kind: 'string', maxBytes: 4096 } as const

/** Product declarations only; the foundation owns encoding, requests, limits and errors. */
function planning(
  path: OracleEpmPathPart[],
  overrides: Partial<Omit<OracleEpmEndpointDeclaration, 'path' | 'version'>> = {}
) {
  return planningRouteSpace.defineEndpoint({
    version: 'v3',
    method: 'GET',
    path,
    body: 'none',
    response: 'json',
    timeoutMs: 60_000,
    maxResponseBytes: PLANNING_INLINE_BYTES,
    ...overrides,
  })
}

function interop(
  path: OracleEpmPathPart[],
  overrides: Partial<Omit<OracleEpmEndpointDeclaration, 'path'>> = {}
) {
  return planningInteropRouteSpace.defineEndpoint({
    version: 'v2',
    method: 'GET',
    path,
    body: 'none',
    response: 'json',
    timeoutMs: 60_000,
    maxResponseBytes: PLANNING_INLINE_BYTES,
    ...overrides,
  })
}

const jsonPost = { method: 'POST', body: 'json', maxRequestBytes: PLANNING_INLINE_BYTES } as const
/** Form encoding is product-local; the foundation bounds the bytes and declares the header. */
const formPost = {
  method: 'POST',
  body: 'stream',
  maxRequestBytes: PLANNING_INLINE_BYTES,
  headers: {
    contentType: {
      name: 'Content-Type',
      maxBytes: 64,
      pattern: /^application\/x-www-form-urlencoded$/,
      required: true,
    },
  },
} as const
const uploadPath = [
  literal('applicationsnapshots'),
  parameter('fileName', { maxBytes: 255, mode: 'repository-path' }),
  literal('contents'),
]
const uploadQuery = {
  q: { kind: 'string', maxBytes: 1024, required: true },
} as const
const octetHeader = {
  contentType: {
    name: 'Content-Type',
    maxBytes: 24,
    pattern: /^application\/octet-stream$/,
    required: true,
  },
}

/** Each action cites its official contract in its operation and public tool file. */
export const planningEndpoints = {
  userVariableValues: planning([...application, literal('uservariablevalues')], { query: page }),
  setUserVariableValues: planning([...application, literal('uservariablevalues')], {
    ...jsonPost,
    response: 'empty',
  }),
  planningUnits: planning([...application, literal('planningunits')], {
    ...formPost,
    query: { ...page, q: { ...q, required: true } },
  }),
  planningUnitActions: planning([...application, literal('planningunits'), name('puhIdentifier'), literal('availableactions')], {
    ...formPost,
    query: { q },
  }),
  planningUnitHistory: planning([...application, literal('planningunits'), name('puIdentifier'), literal('historyandannotations')], {
    query: { ...page, q },
  }),
  changePlanningUnitStatus: planning([...application, literal('planningunits'), name('puhIdentifier'), literal('actions')], formPost),
  insights: planning([...application, literal('insights')], jsonPost),
  insightSummary: planning([...application, literal('insights'), literal('summary')], jsonPost),
  applications: planning([literal('applications')]),
  cubes: planning([...application, literal('plantypes')]),
  dimensions: planning([...cube, literal('dimensions')], { query: page }),
  dimension: planning([...cube, literal('dimensions'), name('dimension')], {
    query: { aliasTableName: { kind: 'string', maxBytes: 255 } },
  }),
  member: planning([...member, name('memberName')]),
  addMember: planning(member, jsonPost),
  variables: planning(variables),
  cubeVariables: planning(cubeVariables, { query: { q } }),
  variable: planning([...variables, name('variableName')]),
  cubeVariable: planning([...cubeVariables, name('variableName')], { query: { q } }),
  setVariables: planning(variables, { ...jsonPost, response: 'empty' }),
  deleteVariable: planning([...variables, name('variableName')], {
    method: 'DELETE',
    response: 'empty',
  }),
  deleteCubeVariable: planning([...cubeVariables, name('variableName')], {
    method: 'DELETE',
    response: 'empty',
  }),
  jobDefinitions: planning([...application, literal('jobdefinitions')], { query: { q } }),
  submitJob: planning([...application, literal('jobs')], jsonPost),
  job: planning([...application, literal('jobs'), jobId]),
  jobDetails: planning([...application, literal('jobs'), jobId, literal('details')], {
    query: { ...page, q },
  }),
  exportSlice: planning([...cube, literal('exportdataslice')], jsonPost),
  importSlice: planning([...cube, literal('importdataslice')], jsonPost),
  clearSlice: planning([...cube, literal('cleardataslice')], jsonPost),
  form: planning([...application, literal('forms'), name('form'), literal('data')], {
    query: {
      displayMemberAs: {
        kind: 'string',
        maxBytes: 32,
        pattern: /^(MEMBER_NAME|MEMBER_NAME_THEN_ALIAS|ALIAS_THEN_MEMBER_NAME)$/,
      },
      memberAliasDelimiter: { kind: 'string', maxBytes: 255 },
      forceStartExpanded: { kind: 'boolean' },
    },
  }),
  files: interop([literal('files'), literal('list')]),
  deleteFile: interop([literal('files'), literal('delete')], { ...jsonPost, method: 'DELETE' }),
  uploadControl: interop(uploadPath, {
    version: 'v1',
    method: 'POST',
    query: uploadQuery,
    headers: octetHeader,
  }),
  uploadChunk: interop(uploadPath, {
    version: 'v1',
    method: 'POST',
    body: 'stream',
    query: uploadQuery,
    headers: octetHeader,
    maxRequestBytes: PLANNING_UPLOAD_CHUNK_BYTES,
  }),
  uploadStatus: interop([literal('services'), literal('jobs'), jobId], { version: 'v1' }),
  startDownload: interop([literal('files'), literal('download')], jsonPost),
  downloadStatus: interop([literal('status'), literal('download'), jobId]),
  download: interop([literal('files'), literal('download'), jobId], {
    response: 'stream',
    maxResponseBytes: PLANNING_DOWNLOAD_BYTES,
  }),
  cleanupDownload: interop([literal('files'), literal('download'), jobId], {
    method: 'DELETE',
    timeoutMs: 5000,
  }),
}

export const planningLinkPolicies = {
  planningUnitStatus: planningRouteSpace.defineReturnedLinkPolicy({
    relation: 'self',
    method: 'POST',
    endpoint: planningEndpoints.changePlanningUnitStatus,
    preserveGatewayBasePath: true,
  }),
  uploadStatus: planningInteropRouteSpace.defineReturnedLinkPolicy({
    relation: 'Job Status',
    method: 'GET',
    endpoint: planningEndpoints.uploadStatus,
    preserveGatewayBasePath: true,
  }),
  downloadStatus: planningInteropRouteSpace.defineReturnedLinkPolicy({
    relation: 'Job Status',
    method: 'GET',
    endpoint: planningEndpoints.downloadStatus,
    preserveGatewayBasePath: true,
  }),
  download: planningInteropRouteSpace.defineReturnedLinkPolicy({
    relation: 'Download link',
    method: 'GET',
    endpoint: planningEndpoints.download,
    preserveGatewayBasePath: true,
  }),
}
