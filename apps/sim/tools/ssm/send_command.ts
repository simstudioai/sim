import type { SsmSendCommandParams, SsmSendCommandResponse } from '@/tools/ssm/types'
import type { InternalToolConfig } from '@/tools/types'

export const sendCommandTool: InternalToolConfig<SsmSendCommandParams, SsmSendCommandResponse> = {
  id: 'ssm_send_command',
  name: 'SSM Send Command',
  description: 'Run an SSM document on managed nodes with AWS Systems Manager Run Command',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    documentName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the SSM document to run (e.g., AWS-RunShellScript)',
    },
    instanceIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Managed node IDs to target, as an array of strings (e.g., ["i-0abc123"]). Provide instanceIds or targets',
    },
    targets: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tag or resource-group targets, as an array of {Key, Values} objects. Provide instanceIds or targets',
    },
    documentVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document version to run ($LATEST, $DEFAULT, or a version number)',
    },
    parameters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Document parameters, as an object mapping each parameter name to an array of string values',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comment describing the command, at most 100 characters',
    },
    executionTimeoutSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seconds to wait for a node to acknowledge the command before it times out (30-2592000)',
    },
    maxConcurrency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number or percentage of nodes to run the command on at once (e.g., 10 or 50%)',
    },
    maxErrors: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number or percentage of errors allowed before the command stops (e.g., 0 or 10%)',
    },
    outputS3BucketName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'S3 bucket to store command output in',
    },
    outputS3KeyPrefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'S3 key prefix for stored command output',
    },
    serviceRoleArn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ARN of the IAM service role Systems Manager uses to publish notifications',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      documentName: params.documentName,
      instanceIds: params.instanceIds,
      targets: params.targets,
      documentVersion: params.documentVersion,
      parameters: params.parameters,
      comment: params.comment,
      executionTimeoutSeconds: params.executionTimeoutSeconds,
      maxConcurrency: params.maxConcurrency,
      maxErrors: params.maxErrors,
      outputS3BucketName: params.outputS3BucketName,
      outputS3KeyPrefix: params.outputS3KeyPrefix,
      serviceRoleArn: params.serviceRoleArn,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send command')
    }

    return {
      success: true,
      output: {
        commandId: data.commandId ?? '',
        documentName: data.documentName ?? '',
        documentVersion: data.documentVersion ?? null,
        comment: data.comment ?? null,
        status: data.status ?? '',
        statusDetails: data.statusDetails ?? null,
        requestedDateTime: data.requestedDateTime ?? null,
        expiresAfter: data.expiresAfter ?? null,
        instanceIds: data.instanceIds ?? [],
        targets: data.targets ?? [],
        maxConcurrency: data.maxConcurrency ?? null,
        maxErrors: data.maxErrors ?? null,
        targetCount: data.targetCount ?? null,
        completedCount: data.completedCount ?? null,
        errorCount: data.errorCount ?? null,
        deliveryTimedOutCount: data.deliveryTimedOutCount ?? null,
        executionTimeoutSeconds: data.executionTimeoutSeconds ?? null,
        outputS3BucketName: data.outputS3BucketName ?? null,
        outputS3KeyPrefix: data.outputS3KeyPrefix ?? null,
        outputS3Region: data.outputS3Region ?? null,
        serviceRole: data.serviceRole ?? null,
      },
      error: undefined,
    }
  },

  outputs: {
    commandId: {
      type: 'string',
      description:
        'ID of the command; pass it to ssm_get_command_invocation or ssm_list_command_invocations to read per-node results',
    },
    documentName: {
      type: 'string',
      description: 'Name of the document that was run',
    },
    documentVersion: {
      type: 'string',
      description: 'Document version that was run',
      optional: true,
    },
    comment: {
      type: 'string',
      description: 'Comment supplied with the command',
      optional: true,
    },
    status: {
      type: 'string',
      description:
        'Command status (Pending, InProgress, Success, Cancelled, Failed, TimedOut, Cancelling)',
    },
    statusDetails: {
      type: 'string',
      description: 'Detailed status of the command',
      optional: true,
    },
    requestedDateTime: {
      type: 'string',
      description: 'When the command was requested',
      optional: true,
    },
    expiresAfter: {
      type: 'string',
      description: 'When the command stops being dispatched to nodes that have not run it',
      optional: true,
    },
    instanceIds: {
      type: 'array',
      description: 'Managed node IDs the command targets',
    },
    targets: {
      type: 'json',
      description:
        'Tag or resource-group targets the command was sent to, as an array of {key, values}',
    },
    maxConcurrency: {
      type: 'string',
      description: 'Concurrency setting the command ran with',
      optional: true,
    },
    maxErrors: {
      type: 'string',
      description: 'Error threshold the command ran with',
      optional: true,
    },
    targetCount: {
      type: 'number',
      description: 'Number of targets the command was sent to',
      optional: true,
    },
    completedCount: {
      type: 'number',
      description: 'Number of targets that have completed the command',
      optional: true,
    },
    errorCount: {
      type: 'number',
      description: 'Number of targets whose command execution failed',
      optional: true,
    },
    deliveryTimedOutCount: {
      type: 'number',
      description: 'Number of targets the command could not be delivered to in time',
      optional: true,
    },
    executionTimeoutSeconds: {
      type: 'number',
      description: 'Acknowledgement timeout the command ran with',
      optional: true,
    },
    outputS3BucketName: {
      type: 'string',
      description: 'S3 bucket command output is written to',
      optional: true,
    },
    outputS3KeyPrefix: {
      type: 'string',
      description: 'S3 key prefix command output is written under',
      optional: true,
    },
    outputS3Region: {
      type: 'string',
      description: 'S3 region reported for command output',
      optional: true,
    },
    serviceRole: {
      type: 'string',
      description: 'IAM service role used for notifications',
      optional: true,
    },
  },
}
