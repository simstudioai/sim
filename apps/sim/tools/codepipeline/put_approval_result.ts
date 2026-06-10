import type {
  CodePipelinePutApprovalResultParams,
  CodePipelinePutApprovalResultResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const putApprovalResultTool: ToolConfig<
  CodePipelinePutApprovalResultParams,
  CodePipelinePutApprovalResultResponse
> = {
  id: 'codepipeline_put_approval_result',
  name: 'CodePipeline Put Approval Result',
  description:
    'Approve or reject a pending CodePipeline manual approval action. The approval token is available from Get Pipeline State on the pending approval action',
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
    pipelineName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the pipeline',
    },
    stageName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the stage containing the approval action',
    },
    actionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the manual approval action',
    },
    token: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Approval token from Get Pipeline State for the pending approval',
    },
    status: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Approval decision: Approved or Rejected',
    },
    summary: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Summary explaining the approval decision (max 512 characters)',
    },
  },

  request: {
    url: '/api/tools/codepipeline/put-approval-result',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      pipelineName: params.pipelineName,
      stageName: params.stageName,
      actionName: params.actionName,
      token: params.token,
      status: params.status,
      summary: params.summary,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to submit CodePipeline approval result')
    }

    return {
      success: true,
      output: {
        approvedAt: data.output.approvedAt,
        status: data.output.status,
      },
    }
  },

  outputs: {
    approvedAt: {
      type: 'number',
      description: 'Epoch ms when the approval or rejection was submitted',
      optional: true,
    },
    status: {
      type: 'string',
      description: 'The submitted approval decision (Approved or Rejected)',
    },
  },
}
