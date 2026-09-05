import {
  OCI_LOGGING_RESPONSE_METADATA,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingPutLogsTool: InternalToolConfig<
  OciLoggingParams<'put_logs'>,
  OciLoggingResponse<'put_logs'>
> = {
  id: 'oci_logging_put_logs',
  name: 'OCI Logging Put Logs',
  description:
    'Ingest custom log batches with one provider attempt per execution. Leave whole-block retries disabled to avoid replay. Returns acceptance only, without per-entry results or indexing guarantees. Cancellation after submission does not undo ingestion.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    logId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Log OCID. Put Logs requires a CUSTOM log.',
    },
    logEntryBatches: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Nonempty batches with source, type, defaultlogentrytime and entries; optional subject. Each entry has data (string), a stable caller-supplied id (1–255 characters), and optional time. Timestamps use RFC3339 with milliseconds. Each serialized entry must be smaller than 1 MB. Oracle may truncate oversized data fields during ingestion; acceptance is not indexing completion.',
      minItems: 1,
      items: {
        type: 'object',
        required: ['source', 'type', 'defaultlogentrytime', 'entries'],
        properties: {
          source: {
            type: 'string',
          },
          type: {
            type: 'string',
          },
          subject: {
            type: 'string',
          },
          defaultlogentrytime: {
            type: 'string',
            format: 'date-time',
          },
          entries: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['data', 'id'],
              properties: {
                data: {
                  type: 'string',
                },
                id: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 255,
                },
                time: {
                  type: 'string',
                  format: 'date-time',
                },
              },
            },
          },
        },
      },
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_LOGGING_RESPONSE_METADATA,
    accepted: {
      type: 'boolean',
      description:
        'Oracle accepted the request. No per-entry outcome or indexing completion is reported.',
    },
  },
}
