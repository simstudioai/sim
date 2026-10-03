import {
  OCI_LOGGING_RESOURCE_METADATA,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingGetWorkRequestTool: InternalToolConfig<
  OciLoggingParams<'get_work_request'>,
  OciLoggingResponse<'get_work_request'>
> = {
  id: 'oci_logging_get_work_request',
  name: 'OCI Logging Get Work Request',
  description: 'Get status, progress and resources for an asynchronous Logging work request.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    workRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Logging work request OCID returned by a management mutation.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_LOGGING_RESOURCE_METADATA,
    retryAfter: {
      type: 'number',
      optional: true,
      description: 'Seconds Oracle recommends waiting before polling again.',
    },
    workRequest: {
      type: 'json',
      description: 'Asynchronous work request.',
      properties: {
        id: {
          type: 'string',
          description: 'Work request OCID.',
        },
        compartmentId: {
          type: 'string',
          description: 'Compartment OCID.',
        },
        operationType: {
          type: 'string',
          description: 'Management operation being processed.',
        },
        status: {
          type: 'string',
          description: 'ACCEPTED, IN_PROGRESS, FAILED, SUCCEEDED, CANCELLING, or CANCELED.',
        },
        percentComplete: {
          type: 'number',
          description: 'Completion percentage.',
        },
        timeAccepted: {
          type: 'string',
          description: 'Acceptance timestamp.',
        },
        timeStarted: {
          type: 'string',
          optional: true,
          description: 'Start timestamp.',
        },
        timeFinished: {
          type: 'string',
          optional: true,
          description: 'Completion timestamp.',
        },
        resources: {
          type: 'array',
          description: 'Affected resources.',
          items: {
            type: 'object',
            properties: {
              actionType: {
                type: 'string',
                description: 'CREATED, UPDATED, DELETED, IN_PROGRESS, or RELATED.',
              },
              entityType: {
                type: 'string',
                description: 'Resource type.',
              },
              identifier: {
                type: 'string',
                description: 'Resource identifier.',
              },
              entityUri: {
                type: 'string',
                optional: true,
                description: 'Resource URI path.',
              },
            },
          },
        },
      },
    },
  },
}
