import type {
  CodePipelineGetPipelineExecutionParams,
  CodePipelineGetPipelineExecutionResponse,
} from '@/tools/codepipeline/types'
import type { ToolConfig } from '@/tools/types'

export const getPipelineExecutionTool: ToolConfig<
  CodePipelineGetPipelineExecutionParams,
  CodePipelineGetPipelineExecutionResponse
> = {
  id: 'codepipeline_get_pipeline_execution',
  name: 'CodePipeline Get Pipeline Execution',
  description:
    'Get details of a CodePipeline execution, including status, trigger, source revisions, and resolved variables',
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
    pipelineExecutionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the pipeline execution',
    },
  },

  request: {
    url: '/api/tools/codepipeline/get-pipeline-execution',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      region: params.awsRegion,
      accessKeyId: params.awsAccessKeyId,
      secretAccessKey: params.awsSecretAccessKey,
      pipelineName: params.pipelineName,
      pipelineExecutionId: params.pipelineExecutionId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get CodePipeline pipeline execution')
    }

    return {
      success: true,
      output: {
        pipelineExecutionId: data.output.pipelineExecutionId,
        pipelineName: data.output.pipelineName,
        pipelineVersion: data.output.pipelineVersion,
        status: data.output.status,
        statusSummary: data.output.statusSummary,
        executionMode: data.output.executionMode,
        executionType: data.output.executionType,
        triggerType: data.output.triggerType,
        triggerDetail: data.output.triggerDetail,
        artifactRevisions: data.output.artifactRevisions,
        variables: data.output.variables,
      },
    }
  },

  outputs: {
    pipelineExecutionId: { type: 'string', description: 'Pipeline execution ID' },
    pipelineName: { type: 'string', description: 'Pipeline name' },
    pipelineVersion: { type: 'number', description: 'Pipeline version number', optional: true },
    status: {
      type: 'string',
      description:
        'Execution status (Cancelled, InProgress, Stopped, Stopping, Succeeded, Superseded, Failed)',
    },
    statusSummary: {
      type: 'string',
      description: 'Status summary for the execution',
      optional: true,
    },
    executionMode: {
      type: 'string',
      description: 'Execution mode (QUEUED, SUPERSEDED, PARALLEL)',
      optional: true,
    },
    executionType: {
      type: 'string',
      description: 'Execution type (STANDARD or ROLLBACK)',
      optional: true,
    },
    triggerType: {
      type: 'string',
      description: 'What triggered the execution (e.g., Webhook, StartPipelineExecution)',
      optional: true,
    },
    triggerDetail: {
      type: 'string',
      description: 'Detail about the trigger (e.g., user ARN)',
      optional: true,
    },
    artifactRevisions: {
      type: 'array',
      description: 'Source artifact revisions for the execution',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Artifact name' },
          revisionId: { type: 'string', description: 'Revision ID (e.g., commit SHA)' },
          revisionSummary: {
            type: 'string',
            description: 'Revision summary (e.g., commit message)',
          },
          revisionUrl: { type: 'string', description: 'URL of the revision' },
          created: { type: 'number', description: 'Epoch ms when the revision was created' },
        },
      },
    },
    variables: {
      type: 'array',
      description: 'Resolved pipeline variables for the execution',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Variable name' },
          resolvedValue: { type: 'string', description: 'Resolved variable value' },
        },
      },
    },
  },
}
