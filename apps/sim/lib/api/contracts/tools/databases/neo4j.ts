import { z } from 'zod'
import {
  introspectionResponseSchema,
  neo4jEncryptionSchema,
  neo4jResponseSchema,
} from '@/lib/api/contracts/tools/databases/shared'
import {
  type ContractBodyInput,
  type ContractJsonResponse,
  defineRouteContract,
} from '@/lib/api/contracts/types'

const neo4jConnectionBodySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive('Port must be a positive integer'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  encryption: neo4jEncryptionSchema,
})

const neo4jCypherBodySchema = neo4jConnectionBodySchema.extend({
  cypherQuery: z.string().min(1, 'Cypher query is required'),
  parameters: z.record(z.string(), z.unknown()).nullable().optional().default({}),
})

export const neo4jQueryBodySchema = neo4jCypherBodySchema
export const neo4jExecuteBodySchema = neo4jCypherBodySchema
export const neo4jCreateBodySchema = neo4jCypherBodySchema
export const neo4jUpdateBodySchema = neo4jCypherBodySchema
export const neo4jMergeBodySchema = neo4jCypherBodySchema
export const neo4jDeleteBodySchema = neo4jCypherBodySchema.extend({
  detach: z.boolean().optional().default(false),
})
export const neo4jIntrospectBodySchema = neo4jConnectionBodySchema

export const neo4jQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/query',
  body: neo4jQueryBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jExecuteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/execute',
  body: neo4jExecuteBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jCreateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/create',
  body: neo4jCreateBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jUpdateContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/update',
  body: neo4jUpdateBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jDeleteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/delete',
  body: neo4jDeleteBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jMergeContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/merge',
  body: neo4jMergeBodySchema,
  response: { mode: 'json', schema: neo4jResponseSchema },
})

export const neo4jIntrospectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/neo4j/introspect',
  body: neo4jIntrospectBodySchema,
  response: { mode: 'json', schema: introspectionResponseSchema },
})

export type Neo4jQueryRequest = ContractBodyInput<typeof neo4jQueryContract>
export type Neo4jQueryResponse = ContractJsonResponse<typeof neo4jQueryContract>
export type Neo4jExecuteRequest = ContractBodyInput<typeof neo4jExecuteContract>
export type Neo4jExecuteResponse = ContractJsonResponse<typeof neo4jExecuteContract>
export type Neo4jCreateRequest = ContractBodyInput<typeof neo4jCreateContract>
export type Neo4jCreateResponse = ContractJsonResponse<typeof neo4jCreateContract>
export type Neo4jUpdateRequest = ContractBodyInput<typeof neo4jUpdateContract>
export type Neo4jUpdateResponse = ContractJsonResponse<typeof neo4jUpdateContract>
export type Neo4jDeleteRequest = ContractBodyInput<typeof neo4jDeleteContract>
export type Neo4jDeleteResponse = ContractJsonResponse<typeof neo4jDeleteContract>
export type Neo4jMergeRequest = ContractBodyInput<typeof neo4jMergeContract>
export type Neo4jMergeResponse = ContractJsonResponse<typeof neo4jMergeContract>
export type Neo4jIntrospectRequest = ContractBodyInput<typeof neo4jIntrospectContract>
export type Neo4jIntrospectResponse = ContractJsonResponse<typeof neo4jIntrospectContract>
