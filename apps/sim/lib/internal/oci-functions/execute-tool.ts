import type { z } from 'zod'
import { authorizeCredentialUseForAuth } from '@/lib/auth/credential-access'
import { AuthType } from '@/lib/auth/hybrid'
import { OciClientError } from '@/lib/internal/oci/errors'
import { OciFunctionsError, prepareOciFunctionsClient } from '@/lib/internal/oci-functions/client'
import { ociFunctionsInputSchemas } from '@/lib/internal/oci-functions/input'
import {
  executeOciFunctionsChangeApplicationCompartment,
  executeOciFunctionsCreateApplication,
  executeOciFunctionsCreateFunction,
  executeOciFunctionsDeleteApplication,
  executeOciFunctionsDeleteFunction,
  executeOciFunctionsGetApplication,
  executeOciFunctionsGetFunction,
  executeOciFunctionsInvoke,
  executeOciFunctionsListApplications,
  executeOciFunctionsListFunctions,
  executeOciFunctionsUpdateApplication,
  executeOciFunctionsUpdateFunction,
  type OciFunctionsOperationContext,
} from '@/lib/internal/oci-functions/operations'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

async function execute<Input extends { oauthCredential: string; region?: string }>(
  request: InternalToolOperationCall,
  schema: z.ZodType<Input>,
  operation: (input: Input, context: OciFunctionsOperationContext) => Promise<unknown>
): Promise<Response> {
  const { context, signal, requestId } = request
  const retryable = request.toolId === 'oci_functions_invoke' ? false : undefined
  try {
    signal?.throwIfAborted()
    const parsed = schema.safeParse(request.input)
    if (!parsed.success)
      return Response.json(
        {
          success: false,
          error: parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
          retryable,
        },
        { status: 400 }
      )
    if (!context.userId || !context.workspaceId)
      return Response.json(
        { success: false, error: 'Trusted user and workspace context are required', retryable },
        { status: 403 }
      )
    const access = await authorizeCredentialUseForAuth(
      { success: true, userId: context.userId, authType: AuthType.INTERNAL_JWT },
      {
        credentialId: parsed.data.oauthCredential,
        workflowId: context.workflowId || undefined,
        workspaceId: context.workspaceId,
        callerUserId: context.userId,
      }
    )
    signal?.throwIfAborted()
    if (
      !access.ok ||
      !access.resolvedCredentialId ||
      access.credentialType !== 'service_account' ||
      access.workspaceId !== context.workspaceId
    ) {
      return Response.json(
        { success: false, error: 'OCI credential is unavailable in this workspace', retryable },
        { status: 403 }
      )
    }
    const prepared = await prepareOciFunctionsClient({
      credentialId: access.resolvedCredentialId,
      workspaceId: context.workspaceId,
      region: parsed.data.region,
    })
    signal?.throwIfAborted()
    const result = await operation(parsed.data, {
      prepared,
      userId: context.userId,
      requestId,
      signal,
    })
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OciClientError) {
      return Response.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          status: error.status,
          opcRequestId: error.opcRequestId,
          retryable,
        },
        { status: error.status ?? 502 }
      )
    }
    if (error instanceof OciFunctionsError)
      return Response.json(
        { success: false, error: error.message, retryable },
        { status: error.status }
      )
    return Response.json(
      { success: false, error: 'OCI Functions operation failed', retryable },
      { status: 500 }
    )
  }
}

export const executeOciFunctionsTool: InternalToolOperationHandler = async (request) => {
  switch (request.toolId) {
    case 'oci_functions_invoke':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_invoke,
        executeOciFunctionsInvoke
      )
    case 'oci_functions_list_applications':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_list_applications,
        executeOciFunctionsListApplications
      )
    case 'oci_functions_get_application':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_get_application,
        executeOciFunctionsGetApplication
      )
    case 'oci_functions_create_application':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_create_application,
        executeOciFunctionsCreateApplication
      )
    case 'oci_functions_update_application':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_update_application,
        executeOciFunctionsUpdateApplication
      )
    case 'oci_functions_delete_application':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_delete_application,
        executeOciFunctionsDeleteApplication
      )
    case 'oci_functions_change_application_compartment':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_change_application_compartment,
        executeOciFunctionsChangeApplicationCompartment
      )
    case 'oci_functions_list_functions':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_list_functions,
        executeOciFunctionsListFunctions
      )
    case 'oci_functions_get_function':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_get_function,
        executeOciFunctionsGetFunction
      )
    case 'oci_functions_create_function':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_create_function,
        executeOciFunctionsCreateFunction
      )
    case 'oci_functions_update_function':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_update_function,
        executeOciFunctionsUpdateFunction
      )
    case 'oci_functions_delete_function':
      return execute(
        request,
        ociFunctionsInputSchemas.oci_functions_delete_function,
        executeOciFunctionsDeleteFunction
      )
    default:
      return Response.json(
        { success: false, error: 'Unsupported OCI Functions operation' },
        { status: 400 }
      )
  }
}
