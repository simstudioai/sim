import type {
  CloudFormationDetectStackDriftParams,
  CloudFormationDetectStackDriftResponse,
} from '@/tools/cloudformation/types'
import type { ToolConfig } from '@/tools/types'

export const detectStackDriftTool: ToolConfig<
  CloudFormationDetectStackDriftParams,
  CloudFormationDetectStackDriftResponse
> = {
  id: 'cloudformation_detect_stack_drift',
  name: 'CloudFormation Detect Stack Drift',
  description: 'Initiate drift detection on a CloudFormation stack',
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
    stackName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stack name or ID to detect drift on',
    },
  },

  request: {
    url: '/api/tools/cloudformation/detect-stack-drift',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      stackName: params.stackName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to detect CloudFormation stack drift')
    }

    return {
      success: true,
      output: {
        stackDriftDetectionId: data.output.stackDriftDetectionId,
      },
    }
  },

  outputs: {
    stackDriftDetectionId: {
      type: 'string',
      description: 'ID to use with Describe Stack Drift Detection Status to check results',
    },
  },
}
