import { z } from 'zod'
import type { OciClient, OciRequest } from '@/lib/internal/oci/client.server'
import { createOciStaticEndpointPolicy } from '@/lib/internal/oci/endpoints'
import type { OciEventsInput, OciEventsOperation } from '@/lib/internal/oci-events/input'
import type { OciEventsResponse } from '@/tools/oci_events/types'

export const OCI_EVENTS_ENDPOINT = createOciStaticEndpointPolicy({
  serviceId: 'oci_events',
  serviceName: 'events',
  hostnameTemplate: 'regional-oci',
})

const optionalString = z.string().nullable().optional()
const ruleSummarySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  compartmentId: z.string(),
  condition: z.string(),
  isEnabled: z.boolean(),
  lifecycleState: z.string(),
  timeCreated: z.string(),
  description: optionalString,
  freeformTags: z.record(z.string(), z.string()).nullable().optional(),
  definedTags: z.record(z.string(), z.record(z.string(), z.json())).nullable().optional(),
})
const actionFields = {
  id: z.string(),
  lifecycleState: z.string(),
  lifecycleMessage: optionalString,
  isEnabled: z.boolean().nullable().optional(),
  description: optionalString,
}
const actionSchema = z.discriminatedUnion('actionType', [
  z.object({ ...actionFields, actionType: z.literal('ONS'), topicId: optionalString }),
  z.object({ ...actionFields, actionType: z.literal('OSS'), streamId: optionalString }),
  z.object({ ...actionFields, actionType: z.literal('FAAS'), functionId: optionalString }),
])
const ruleSchema = ruleSummarySchema.extend({
  actions: z.object({ actions: z.array(actionSchema).max(10) }),
  lifecycleMessage: optionalString,
})

export type OciEventRuleSummary = z.output<typeof ruleSummarySchema>
export type OciEventRule = z.output<typeof ruleSchema>

export class OciEventsInputError extends Error {}

function selectFields(input: OciEventsInput, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const value = Reflect.get(input, key)
    if (value !== undefined) result[key] = value
  }
  return result
}

export async function executeOciEventsOperation(
  client: OciClient,
  operation: OciEventsOperation,
  input: OciEventsInput,
  signal?: AbortSignal
): Promise<OciEventsResponse> {
  signal?.throwIfAborted()
  const rulePath = 'ruleId' in input ? `/rules/${encodeURIComponent(input.ruleId)}` : '/rules'
  const queryPairs: [string, string][] = []
  if (operation === 'list_rules') {
    for (const [key, value] of Object.entries(
      selectFields(input, [
        'compartmentId',
        'limit',
        'page',
        'displayName',
        'lifecycleState',
        'sortBy',
        'sortOrder',
      ])
    )) {
      queryPairs.push([key, String(value)])
    }
  }
  const body = selectFields(
    input,
    operation === 'create_rule' || operation === 'update_rule'
      ? [
          'displayName',
          'description',
          'isEnabled',
          'condition',
          'actions',
          'freeformTags',
          'definedTags',
        ]
      : []
  )
  if (body.condition !== undefined) body.condition = JSON.stringify(body.condition)
  if (body.actions !== undefined) body.actions = { actions: body.actions }
  if (operation === 'create_rule' && 'compartmentId' in input) {
    body.compartmentId = input.compartmentId
  }
  if (operation === 'change_rule_compartment' && 'destinationCompartmentId' in input) {
    body.compartmentId = input.destinationCompartmentId
  }
  if (operation === 'update_rule' && !Object.keys(body).length) {
    throw new OciEventsInputError('Provide at least one rule field to update')
  }
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  if (bytes.byteLength > 1024 * 1024) {
    throw new OciEventsInputError('Events request exceeds the 1 MiB Sim request limit')
  }
  const endpoint = await client.prepareStaticEndpoint(OCI_EVENTS_ENDPOINT)
  signal?.throwIfAborted()
  const headers: Record<string, string> = {}
  if ('ifMatch' in input && input.ifMatch) headers['if-match'] = input.ifMatch
  if (input.opcRequestId) headers['opc-request-id'] = input.opcRequestId
  const base = {
    endpoint,
    encodedPath: `/20181201${rulePath}${operation === 'change_rule_compartment' ? '/actions/changeCompartment' : ''}`,
    queryPairs,
    headers,
    responseHeaders: ['opc-next-page', 'etag'],
    timeoutMs: 60_000,
    maxResponseBytes: 8 * 1024 * 1024,
    signal,
  }
  let request: OciRequest
  if (operation === 'list_rules' || operation === 'get_rule') {
    request = { ...base, method: 'GET', retry: { kind: 'safe', maxAttempts: 3 } }
  } else if (operation === 'delete_rule') {
    request = { ...base, method: 'DELETE' }
  } else {
    request = {
      ...base,
      method: operation === 'update_rule' ? 'PUT' : 'POST',
      body: bytes,
      contentType: 'application/json',
      ...('opcRetryToken' in input && input.opcRetryToken
        ? { retry: { kind: 'tokenized' as const, retryToken: input.opcRetryToken, maxAttempts: 3 } }
        : {}),
    }
  }
  const response = await client.request(request)
  const output: OciEventsResponse['output'] = {
    status: response.status,
    opcRequestId: response.opcRequestId ?? null,
  }
  if (operation !== 'delete_rule' && operation !== 'change_rule_compartment') {
    try {
      const data: unknown = JSON.parse(new TextDecoder().decode(response.body))
      if (operation === 'list_rules') {
        output.rules = z
          .array(ruleSummarySchema)
          .max('limit' in input ? input.limit : 10)
          .parse(data)
        output.nextPage = response.headers['opc-next-page'] ?? null
      } else {
        output.rule = ruleSchema.parse(data)
        output.etag = response.headers.etag ?? null
      }
    } catch {
      throw new Error('OCI Events returned an unexpected response')
    }
  }
  return { success: true, output }
}
