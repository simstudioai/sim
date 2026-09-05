import { createLogger } from '@sim/logger'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  OCI_FUNCTIONS_INVOCATION_POLICY,
  OciFunctionsError,
  ociFunctionsResourcePath,
  ociFunctionsResponseMetadata,
  type PreparedOciFunctionsClient,
  projectOciFunctionsResource,
  requestOciFunctionsManagement,
} from '@/lib/internal/oci-functions/client'
import {
  OCI_FUNCTIONS_PAYLOAD_LIMIT,
  type OciFunctionsInputs,
} from '@/lib/internal/oci-functions/input'
import { parseRawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processSingleFileToUserFile } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { OciFunctionsJson, OciFunctionsListParams } from '@/tools/oci_functions/types'

const logger = createLogger('OciFunctionsOperations')
export interface OciFunctionsOperationContext {
  prepared: PreparedOciFunctionsClient
  userId: string
  requestId: string
  signal?: AbortSignal
}

function listQuery(input: OciFunctionsListParams, scope: [string, string]): [string, string][] {
  const pairs: [string, string][] = [scope, ['limit', String(input.limit ?? 10)]]
  for (const key of [
    'page',
    'displayName',
    'id',
    'lifecycleState',
    'sortBy',
    'sortOrder',
  ] as const) {
    if (input[key] !== undefined) pairs.push([key, String(input[key])])
  }
  return pairs
}

async function resource(
  context: OciFunctionsOperationContext,
  kind: 'applications' | 'functions',
  id: string
) {
  const response = await requestOciFunctionsManagement(
    context.prepared,
    { method: 'GET', path: ociFunctionsResourcePath(kind, id) },
    context.signal
  )
  return {
    success: true,
    output: {
      ...ociFunctionsResponseMetadata(response),
      [kind === 'applications' ? 'application' : 'function']: projectOciFunctionsResource(
        response,
        kind
      ),
    },
  }
}

export async function executeOciFunctionsListApplications(
  input: OciFunctionsInputs['oci_functions_list_applications'],
  context: OciFunctionsOperationContext
) {
  const response = await requestOciFunctionsManagement(
    context.prepared,
    {
      method: 'GET',
      path: ociFunctionsResourcePath('applications'),
      query: listQuery(input, ['compartmentId', input.compartmentId]),
    },
    context.signal
  )
  return {
    success: true,
    output: {
      ...ociFunctionsResponseMetadata(response),
      applications: projectOciFunctionsResource(response, 'applications', true),
    },
  }
}
export async function executeOciFunctionsGetApplication(
  input: OciFunctionsInputs['oci_functions_get_application'],
  context: OciFunctionsOperationContext
) {
  return resource(context, 'applications', input.applicationId)
}
export async function executeOciFunctionsCreateApplication(
  input: OciFunctionsInputs['oci_functions_create_application'],
  context: OciFunctionsOperationContext
) {
  const response = await requestOciFunctionsManagement(
    context.prepared,
    {
      method: 'POST',
      path: ociFunctionsResourcePath('applications'),
      body: {
        compartmentId: input.compartmentId,
        displayName: input.displayName,
        subnetIds: input.subnetIds,
        shape: input.shape,
        ...input.configuration,
      },
    },
    context.signal
  )
  return {
    success: true,
    output: {
      ...ociFunctionsResponseMetadata(response),
      application: projectOciFunctionsResource(response, 'applications'),
    },
  }
}
export async function executeOciFunctionsUpdateApplication(
  input: OciFunctionsInputs['oci_functions_update_application'],
  context: OciFunctionsOperationContext
) {
  const response = await requestOciFunctionsManagement(
    context.prepared,
    {
      method: 'PUT',
      path: ociFunctionsResourcePath('applications', input.applicationId),
      body: input.configuration,
      ifMatch: input.ifMatch,
    },
    context.signal
  )
  return {
    success: true,
    output: {
      ...ociFunctionsResponseMetadata(response),
      application: projectOciFunctionsResource(response, 'applications'),
    },
  }
}
export async function executeOciFunctionsDeleteApplication(
  input: OciFunctionsInputs['oci_functions_delete_application'],
  context: OciFunctionsOperationContext
) {
  const response = await requestOciFunctionsManagement(
    context.prepared,
    {
      method: 'DELETE',
      path: ociFunctionsResourcePath('applications', input.applicationId),
      ifMatch: input.ifMatch,
    },
    context.signal
  )
  return {
    success: true,
    output: { ...ociFunctionsResponseMetadata(response), applicationId: input.applicationId },
  }
}
export async function executeOciFunctionsChangeApplicationCompartment(
  input: OciFunctionsInputs['oci_functions_change_application_compartment'],
  context: OciFunctionsOperationContext
) {
  const response = await requestOciFunctionsManagement(
    context.prepared,
    {
      method: 'POST',
      path: `${ociFunctionsResourcePath('applications', input.applicationId)}/actions/changeCompartment`,
      body: { compartmentId: input.compartmentId },
      ifMatch: input.ifMatch,
    },
    context.signal
  )
  return {
    success: true,
    output: {
      ...ociFunctionsResponseMetadata(response),
      applicationId: input.applicationId,
      compartmentId: input.compartmentId,
    },
  }
}
export async function executeOciFunctionsListFunctions(
  input: OciFunctionsInputs['oci_functions_list_functions'],
  context: OciFunctionsOperationContext
) {
  const response = await requestOciFunctionsManagement(
    context.prepared,
    {
      method: 'GET',
      path: ociFunctionsResourcePath('functions'),
      query: listQuery(input, ['applicationId', input.applicationId]),
    },
    context.signal
  )
  return {
    success: true,
    output: {
      ...ociFunctionsResponseMetadata(response),
      functions: projectOciFunctionsResource(response, 'functions', true),
    },
  }
}
export async function executeOciFunctionsGetFunction(
  input: OciFunctionsInputs['oci_functions_get_function'],
  context: OciFunctionsOperationContext
) {
  return resource(context, 'functions', input.functionId)
}
function validateConcurrency(memory: number | undefined, count: number | undefined) {
  if (memory === undefined || count === undefined) return
  const increment = memory === 128 ? 40 : memory === 256 ? 20 : 10
  if (count % increment !== 0)
    throw new OciFunctionsError(
      `Provisioned concurrency must be a multiple of ${increment} for this memory size`
    )
}
export async function executeOciFunctionsCreateFunction(
  input: OciFunctionsInputs['oci_functions_create_function'],
  context: OciFunctionsOperationContext
) {
  const concurrency = input.configuration?.provisionedConcurrencyConfig
  validateConcurrency(
    input.memoryInMBs,
    concurrency?.strategy === 'CONSTANT' ? concurrency.count : undefined
  )
  const response = await requestOciFunctionsManagement(
    context.prepared,
    {
      method: 'POST',
      path: ociFunctionsResourcePath('functions'),
      body: {
        applicationId: input.applicationId,
        displayName: input.displayName,
        image: input.image,
        memoryInMBs: input.memoryInMBs,
        ...input.configuration,
      },
    },
    context.signal
  )
  return {
    success: true,
    output: {
      ...ociFunctionsResponseMetadata(response),
      function: projectOciFunctionsResource(response, 'functions'),
    },
  }
}
export async function executeOciFunctionsUpdateFunction(
  input: OciFunctionsInputs['oci_functions_update_function'],
  context: OciFunctionsOperationContext
) {
  const concurrency = input.configuration?.provisionedConcurrencyConfig
  validateConcurrency(
    input.memoryInMBs,
    concurrency?.strategy === 'CONSTANT' ? concurrency.count : undefined
  )
  const response = await requestOciFunctionsManagement(
    context.prepared,
    {
      method: 'PUT',
      path: ociFunctionsResourcePath('functions', input.functionId),
      body: { image: input.image, memoryInMBs: input.memoryInMBs, ...input.configuration },
      ifMatch: input.ifMatch,
    },
    context.signal
  )
  return {
    success: true,
    output: {
      ...ociFunctionsResponseMetadata(response),
      function: projectOciFunctionsResource(response, 'functions'),
    },
  }
}
export async function executeOciFunctionsDeleteFunction(
  input: OciFunctionsInputs['oci_functions_delete_function'],
  context: OciFunctionsOperationContext
) {
  const response = await requestOciFunctionsManagement(
    context.prepared,
    {
      method: 'DELETE',
      path: ociFunctionsResourcePath('functions', input.functionId),
      ifMatch: input.ifMatch,
    },
    context.signal
  )
  return {
    success: true,
    output: { ...ociFunctionsResponseMetadata(response), functionId: input.functionId },
  }
}

async function invocationBody(
  input: OciFunctionsInputs['oci_functions_invoke'],
  context: OciFunctionsOperationContext
) {
  if (input.payloadType === 'file') {
    if (!input.file) throw new OciFunctionsError('A single uploaded file is required')
    const rawFile = parseRawFileInput(input.file)
    if (!rawFile) throw new OciFunctionsError('File must be a valid uploaded file object')
    const file = processSingleFileToUserFile(rawFile, context.requestId, logger)
    const denied = await assertToolFileAccess(file.key, context.userId, context.requestId, logger)
    context.signal?.throwIfAborted()
    if (denied) throw new OciFunctionsError('File is unavailable', denied.status)
    try {
      const downloaded = await downloadServableFileFromStorage(file, context.requestId, logger, {
        maxBytes: OCI_FUNCTIONS_PAYLOAD_LIMIT,
        signal: context.signal,
      })
      return {
        body: downloaded.buffer,
        contentType: input.contentType ?? (downloaded.contentType || 'application/octet-stream'),
      }
    } catch (error) {
      context.signal?.throwIfAborted()
      if (isPayloadSizeLimitError(error))
        throw new OciFunctionsError('Invocation file exceeds 6 MB', 413)
      throw error
    }
  }
  const value =
    input.payload === undefined
      ? ''
      : input.payloadType === 'json'
        ? JSON.stringify(input.payload)
        : String(input.payload)
  return {
    body: new TextEncoder().encode(value),
    contentType:
      input.contentType ??
      (input.payloadType === 'json' ? 'application/json' : 'text/plain; charset=utf-8'),
  }
}

function invocationResult(body: Uint8Array, contentType: string, outputFormat: 'auto' | 'file') {
  const asFile = () => ({
    file: {
      name: 'function-result.bin',
      mimeType: contentType,
      data: Buffer.from(body).toString('base64'),
      size: body.byteLength,
    },
  })
  /** Sim does not materialize zero-byte UserFiles; preserve the empty result instead. */
  if (body.byteLength === 0) return { result: '' }
  if (outputFormat === 'file') return asFile()
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return asFile()
  }
  let result: OciFunctionsJson
  try {
    result = JSON.parse(text) as OciFunctionsJson
  } catch {
    if (
      !contentType.toLowerCase().startsWith('text/') &&
      !/json|xml|javascript|x-www-form-urlencoded/i.test(contentType)
    )
      return asFile()
    result = text
  }
  /** Escaped text can exceed Sim's buffered response budget; file output stays bounded. */
  if (Buffer.byteLength(JSON.stringify(result)) > 9_000_000) return asFile()
  return { result }
}

/** A lost invocation response can follow execution; do not retry this operation. */
export async function executeOciFunctionsInvoke(
  input: OciFunctionsInputs['oci_functions_invoke'],
  context: OciFunctionsOperationContext
) {
  context.signal?.throwIfAborted()
  const payload = await invocationBody(input, context)
  if (payload.body.byteLength > OCI_FUNCTIONS_PAYLOAD_LIMIT)
    throw new OciFunctionsError('Invocation payload exceeds 6 MB', 413)
  const managementResponse = await requestOciFunctionsManagement(
    context.prepared,
    { method: 'GET', path: ociFunctionsResourcePath('functions', input.functionId) },
    context.signal
  )
  projectOciFunctionsResource(managementResponse, 'functions')
  const endpoint = await context.prepared.client.prepareDiscoveredEndpoint(
    OCI_FUNCTIONS_INVOCATION_POLICY,
    managementResponse
  )
  context.signal?.throwIfAborted()
  const response = await context.prepared.client.request({
    endpoint,
    method: 'POST',
    encodedPath: `${ociFunctionsResourcePath('functions', input.functionId)}/actions/invoke`,
    ...payload,
    headers: {
      'fn-invoke-type': input.invocationType,
      'is-dry-run': String(input.dryRun),
      ...(input.intent ? { 'fn-intent': input.intent } : {}),
    },
    timeoutMs: input.timeoutMs,
    maxResponseBytes: OCI_FUNCTIONS_PAYLOAD_LIMIT,
    signal: context.signal,
  })
  context.signal?.throwIfAborted()
  if (response.status !== 200 && response.status !== 202)
    throw new OciFunctionsError('Unexpected OCI Functions invocation status', 502)
  const output = {
    ...ociFunctionsResponseMetadata(response),
    functionId: input.functionId,
    invocationType: input.invocationType,
    dryRun: input.dryRun,
  }
  if (response.status === 202) return { success: true, output: { ...output, accepted: true } }
  if (input.dryRun) return { success: true, output }
  const contentType = response.headers['content-type'] || 'application/octet-stream'
  return {
    success: true,
    output: {
      ...output,
      contentType,
      ...invocationResult(response.body, contentType, input.outputFormat),
    },
  }
}
