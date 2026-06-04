import type {
  CloudFormationDescribeStackDriftDetectionStatusParams,
  CloudFormationDescribeStackDriftDetectionStatusResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const describeStackDriftDetectionStatusTool: ToolConfig<
  CloudFormationDescribeStackDriftDetectionStatusParams,
  CloudFormationDescribeStackDriftDetectionStatusResponse
> = {
  id: 'cloudformation_describe_stack_drift_detection_status',
  name: 'CloudFormation Describe Stack Drift Detection Status',
  description: 'Check the status of a stack drift detection operation',
  version: '1.0.0',

  params: {
    awsRegion: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    awsAccessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    awsSecretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
    stackDriftDetectionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The drift detection ID returned by Detect Stack Drift',
    },
  },

  request: {
    url: '/api/tools/cloudformation/describe-stack-drift-detection-status',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      stackDriftDetectionId: params.stackDriftDetectionId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to describe stack drift detection status')
    }

    return {
      success: true,
      output: {
        stackId: data.output.stackId,
        stackDriftDetectionId: data.output.stackDriftDetectionId,
        stackDriftStatus: data.output.stackDriftStatus,
        detectionStatus: data.output.detectionStatus,
        detectionStatusReason: data.output.detectionStatusReason,
        driftedStackResourceCount: data.output.driftedStackResourceCount,
        timestamp: data.output.timestamp,
      },
    }
  },

  outputs: {
    stackId: { type: 'string', description: 'The stack ID' },
    stackDriftDetectionId: { type: 'string', description: 'The drift detection ID' },
    stackDriftStatus: {
      type: 'string',
      description: 'Drift status (DRIFTED, IN_SYNC, NOT_CHECKED)',
    },
    detectionStatus: {
      type: 'string',
      description: 'Detection status (DETECTION_IN_PROGRESS, DETECTION_COMPLETE, DETECTION_FAILED)',
    },
    detectionStatusReason: { type: 'string', description: 'Reason if detection failed' },
    driftedStackResourceCount: {
      type: 'number',
      description: 'Number of resources that have drifted',
    },
    timestamp: { type: 'number', description: 'Timestamp of the detection' },
  },
}
