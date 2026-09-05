import {
  oracleEpmLiteral,
  oracleEpmPathParameter,
  oracleEpmQuery,
} from '@/lib/internal/oracle-epm/endpoint'
import { defineOracleEpmRouteSpace } from '@/lib/internal/oracle-epm/route-space'

export const NARRATIVE_MAX_DOWNLOAD_BYTES = 100 * 1_024 * 1_024
export const NARRATIVE_MAX_SOURCE_BYTES = 99 * 1_024 * 1_024
export const NARRATIVE_MAX_MULTIPART_OVERHEAD_BYTES = 1_024 * 1_024
const MAX_JSON_BYTES = 4 * 1_024 * 1_024

/** Product route declarations; destination and authentication remain foundation-owned. */
export const narrativeRouteSpace = defineOracleEpmRouteSpace({
  context: ['epm', 'rest'],
  allowedVersions: ['v1'],
})

/**
 * Exact documented endpoint policies. Files and package collection/output policies
 * are intentionally absent pending resolution of contradictory Oracle contracts.
 * @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-reporting-cloud/raepr/openapi.json
 */
export const narrativeEndpoints = {
  listArtifacts: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('artifacts')],
    query: {
      fields: oracleEpmQuery.string({ maxBytes: 1_024 }),
      limit: oracleEpmQuery.integer({ minimum: 1, maximum: 100 }),
      offset: oracleEpmQuery.integer({ minimum: 0, maximum: 1_000_000 }),
      q: oracleEpmQuery.string({ maxBytes: 4_096 }),
      orderBy: oracleEpmQuery.string({ maxBytes: 4_096 }),
    },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  listArtifactChildren: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [
      oracleEpmLiteral('artifacts'),
      oracleEpmPathParameter('id', { maxBytes: 255 }),
      oracleEpmLiteral('children'),
    ],
    query: {
      fields: oracleEpmQuery.string({ maxBytes: 1_024 }),
      limit: oracleEpmQuery.integer({ minimum: 1, maximum: 100 }),
      offset: oracleEpmQuery.integer({ minimum: 0, maximum: 1_000_000 }),
      q: oracleEpmQuery.string({ maxBytes: 4_096 }),
      orderBy: oracleEpmQuery.string({ maxBytes: 4_096 }),
    },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  getArtifact: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('artifacts'), oracleEpmPathParameter('id', { maxBytes: 255 })],
    query: { fields: oracleEpmQuery.string({ maxBytes: 1_024 }) },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  createArtifact: narrativeRouteSpace.defineEndpoint({
    method: 'POST',
    version: 'v1',
    path: [oracleEpmLiteral('artifacts')],
    query: { overwrite: oracleEpmQuery.boolean() },
    body: 'json',
    response: 'json',
    timeoutMs: 30_000,
    maxRequestBytes: MAX_JSON_BYTES,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  deleteArtifact: narrativeRouteSpace.defineEndpoint({
    method: 'DELETE',
    version: 'v1',
    path: [oracleEpmLiteral('artifacts'), oracleEpmPathParameter('id', { maxBytes: 255 })],
    body: 'none',
    response: 'empty',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  listReports: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('reports')],
    query: {
      fields: oracleEpmQuery.string({ maxBytes: 1_024 }),
      limit: oracleEpmQuery.integer({ minimum: 1, maximum: 100 }),
      offset: oracleEpmQuery.integer({ minimum: 0, maximum: 1_000_000 }),
      q: oracleEpmQuery.string({ maxBytes: 4_096 }),
      orderBy: oracleEpmQuery.string({ maxBytes: 4_096 }),
    },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  getReport: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('reports'), oracleEpmPathParameter('id', { maxBytes: 255 })],
    query: { fields: oracleEpmQuery.string({ maxBytes: 1_024 }) },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  getReportPov: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [
      oracleEpmLiteral('reports'),
      oracleEpmPathParameter('id', { maxBytes: 255 }),
      oracleEpmLiteral('globalPov'),
    ],
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  getReportPrompts: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [
      oracleEpmLiteral('reports'),
      oracleEpmPathParameter('id', { maxBytes: 255 }),
      oracleEpmLiteral('prompts'),
    ],
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  downloadReport: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [
      oracleEpmLiteral('reports'),
      oracleEpmPathParameter('id', { maxBytes: 255 }),
      oracleEpmLiteral('executedReport'),
    ],
    query: {
      format: oracleEpmQuery.string({ required: true, maxBytes: 4, pattern: /^pdf$/ }),
      globalPov: oracleEpmQuery.string({ maxBytes: 4_096 }),
      prompts: oracleEpmQuery.string({ maxBytes: 4_096 }),
    },
    body: 'none',
    response: 'stream',
    timeoutMs: 240_000,
    maxResponseBytes: NARRATIVE_MAX_DOWNLOAD_BYTES,
  }),
  listBooks: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('books')],
    query: {
      fields: oracleEpmQuery.string({ maxBytes: 1_024 }),
      limit: oracleEpmQuery.integer({ minimum: 1, maximum: 100 }),
      offset: oracleEpmQuery.integer({ minimum: 0, maximum: 1_000_000 }),
      q: oracleEpmQuery.string({ maxBytes: 4_096 }),
      orderBy: oracleEpmQuery.string({ maxBytes: 4_096 }),
    },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  getBook: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('books'), oracleEpmPathParameter('id', { maxBytes: 255 })],
    query: { fields: oracleEpmQuery.string({ maxBytes: 1_024 }) },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  getBookPov: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [
      oracleEpmLiteral('books'),
      oracleEpmPathParameter('id', { maxBytes: 255 }),
      oracleEpmLiteral('globalPov'),
    ],
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  downloadBook: narrativeRouteSpace.defineEndpoint({
    method: 'POST',
    version: 'v1',
    path: [
      oracleEpmLiteral('books'),
      oracleEpmPathParameter('id', { maxBytes: 255 }),
      oracleEpmLiteral('output'),
    ],
    query: {
      format: oracleEpmQuery.string({ required: true, maxBytes: 4, pattern: /^(pdf|xlsx)$/ }),
      globalPov: oracleEpmQuery.string({ maxBytes: 4_096 }),
    },
    body: 'none',
    response: 'stream',
    timeoutMs: 240_000,
    maxResponseBytes: NARRATIVE_MAX_DOWNLOAD_BYTES,
  }),
  listSnapshots: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('reportSnapshots')],
    query: {
      fields: oracleEpmQuery.string({ maxBytes: 1_024 }),
      limit: oracleEpmQuery.integer({ minimum: 1, maximum: 100 }),
      offset: oracleEpmQuery.integer({ minimum: 0, maximum: 1_000_000 }),
      q: oracleEpmQuery.string({ maxBytes: 4_096 }),
      orderBy: oracleEpmQuery.string({ maxBytes: 4_096 }),
    },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  getSnapshot: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('reportSnapshots'), oracleEpmPathParameter('id', { maxBytes: 255 })],
    query: { fields: oracleEpmQuery.string({ maxBytes: 1_024 }) },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  downloadSnapshot: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [
      oracleEpmLiteral('reportSnapshots'),
      oracleEpmPathParameter('id', { maxBytes: 255 }),
      oracleEpmLiteral('executedReport'),
    ],
    query: { format: oracleEpmQuery.string({ required: true, maxBytes: 4, pattern: /^pdf$/ }) },
    body: 'none',
    response: 'stream',
    timeoutMs: 240_000,
    maxResponseBytes: NARRATIVE_MAX_DOWNLOAD_BYTES,
  }),
  getReportPackage: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('reportPackages'), oracleEpmPathParameter('id', { maxBytes: 255 })],
    query: { fields: oracleEpmQuery.string({ maxBytes: 1_024 }) },
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  submitJob: narrativeRouteSpace.defineEndpoint({
    method: 'POST',
    version: 'v1',
    path: [oracleEpmLiteral('jobs')],
    body: 'json',
    response: 'json',
    timeoutMs: 30_000,
    maxRequestBytes: MAX_JSON_BYTES,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
  getJob: narrativeRouteSpace.defineEndpoint({
    method: 'GET',
    version: 'v1',
    path: [oracleEpmLiteral('jobs'), oracleEpmPathParameter('id', { maxBytes: 255 })],
    body: 'none',
    response: 'json',
    timeoutMs: 30_000,
    maxResponseBytes: MAX_JSON_BYTES,
  }),
} as const

/** Job examples document absolute self links to this exact, bodyless status endpoint. */
export const narrativeJobSelfPolicy = narrativeRouteSpace.defineReturnedLinkPolicy({
  relation: 'self',
  method: 'GET',
  endpoint: narrativeEndpoints.getJob,
  preserveGatewayBasePath: true,
})
