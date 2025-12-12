import type { ParallelDeepResearchParams } from '@/tools/parallel/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export const deepResearchTool: ToolConfig<ParallelDeepResearchParams, ToolResponse> = {
  id: 'parallel_deep_research',
  name: 'Parallel AI Deep Research',
  description:
    'Conduct comprehensive deep research across the web using Parallel AI. Synthesizes information from multiple sources with citations. Can take up to 15 minutes to complete.',
  version: '1.0.0',

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Research query or question (up to 15,000 characters)',
    },
    processor: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Compute level: base, lite, pro, ultra, ultra2x, ultra4x, ultra8x (default: base)',
    },
    include_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains to restrict research to (source policy)',
    },
    exclude_domains: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated list of domains to exclude from research (source policy)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Parallel AI API Key',
    },
  },

  request: {
    url: 'https://api.parallel.ai/v1/tasks/runs',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        input: params.input,
        processor: params.processor || 'base',
      }

      const taskSpec: Record<string, unknown> = {}

      taskSpec.output_schema = 'auto'

      body.task_spec = taskSpec

      if (params.include_domains || params.exclude_domains) {
        const sourcePolicy: Record<string, string[]> = {}

        if (params.include_domains) {
          sourcePolicy.include_domains = params.include_domains
            .split(',')
            .map((d) => d.trim())
            .filter((d) => d.length > 0)
        }

        if (params.exclude_domains) {
          sourcePolicy.exclude_domains = params.exclude_domains
            .split(',')
            .map((d) => d.trim())
            .filter((d) => d.length > 0)
        }

        if (Object.keys(sourcePolicy).length > 0) {
          body.source_policy = sourcePolicy
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (data.status === 'running') {
      return {
        success: true,
        output: {
          status: 'running',
          run_id: data.run_id,
          message:
            'Deep research task is running. This can take up to 15 minutes. Use the run_id to check status.',
        },
      }
    }

    return {
      success: true,
      output: {
        status: data.status,
        run_id: data.run_id,
        content: data.content || {},
        basis: data.basis || [],
        metadata: data.metadata || {},
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Task status (running, completed, failed)',
    },
    run_id: {
      type: 'string',
      description: 'Unique ID for this research task',
    },
    message: {
      type: 'string',
      description: 'Status message (for running tasks)',
    },
    content: {
      type: 'object',
      description: 'Research results (structured based on output_schema)',
    },
    basis: {
      type: 'array',
      description: 'Citations and sources with excerpts and confidence levels',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Source URL' },
          title: { type: 'string', description: 'Source title' },
          excerpt: { type: 'string', description: 'Relevant excerpt' },
          confidence: { type: 'number', description: 'Confidence level' },
        },
      },
    },
    metadata: {
      type: 'object',
      description: 'Additional task metadata',
    },
  },
}
