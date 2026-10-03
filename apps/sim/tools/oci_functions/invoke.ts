import type { OciFunctionsInvokeParams, OciFunctionsResponse } from '@/tools/oci_functions/types'
import { OCI_FUNCTIONS_METADATA_OUTPUTS } from '@/tools/oci_functions/types'
import { ociFunctionsAuthParams } from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsInvokeTool: InternalToolConfig<
  OciFunctionsInvokeParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_invoke',
  name: 'OCI Functions Invoke',
  description:
    'Invoke an OCI function synchronously, start a detached invocation, or dry-run without executing. Payloads and results are limited to 6 MB. Detached HTTP 202 acknowledges processing and is not a completed result. One provider invocation attempt per tool execution; keep block retries disabled to avoid replay. A lost response can follow successful execution; cancellation ends the wait, not the Oracle execution.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-functions', credentialKind: 'service-account' },
  params: {
    ...ociFunctionsAuthParams,
    functionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Function OCID; endpoint is discovered through an authenticated management read',
    },
    invocationType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'sync (default) or detached',
    },
    dryRun: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Validate invocation without executing the function (default false)',
    },
    intent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional fn-intent: httprequest or cloudevent',
    },
    payloadType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'json (default), text, or file',
    },
    payload: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON value, or a string for text mode; omit for an empty body. JSON false, 0, null, and empty strings are preserved.',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'One uploaded UserFile for file mode; access is checked before download',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content type override; otherwise inferred from payload mode or uploaded file',
    },
    outputFormat: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'auto (default) returns JSON/text or a file for binary data; file returns an execution file, except an empty body returns an empty string',
    },
    timeoutMs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Client wait timeout in milliseconds, 1–300000 (default 300000); execution cancellation can end it earlier',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_FUNCTIONS_METADATA_OUTPUTS,
    functionId: { type: 'string', description: 'Invoked function OCID' },
    invocationType: { type: 'string', description: 'Requested invocation mode: sync or detached' },
    dryRun: { type: 'boolean', description: 'Whether this was a dry-run request' },
    accepted: {
      type: 'boolean',
      optional: true,
      description: 'True for HTTP 202 acknowledgement; no completed result is available',
    },
    contentType: {
      type: 'string',
      optional: true,
      description: 'Result content type, when a result is returned',
    },
    result: {
      type: 'json',
      optional: true,
      nullable: true,
      description:
        'Synchronous JSON value or text; empty response body becomes an empty string. Absent for acknowledgements, dry runs, or non-empty file output.',
    },
    file: {
      type: 'file',
      optional: true,
      description: 'Binary or explicitly requested file result, stored as an execution file',
    },
  },
}
