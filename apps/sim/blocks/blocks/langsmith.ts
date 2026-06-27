import { toError } from '@sim/utils/errors'
import { LangsmithIcon } from '@/components/icons'
import { LangsmithBlockDisplay } from '@/blocks/blocks/langsmith.display'
import { AuthMode, type BlockConfig, type BlockMeta } from '@/blocks/types'
import type { LangsmithResponse } from '@/tools/langsmith/types'

export const LangsmithBlock: BlockConfig<LangsmithResponse> = {
  ...LangsmithBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Run', id: 'langsmith_create_run' },
        { label: 'Create Runs Batch', id: 'langsmith_create_runs_batch' },
      ],
      value: () => 'langsmith_create_run',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your LangSmith API key',
      password: true,
      required: true,
    },
    {
      id: 'id',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'Auto-generated if blank',
      condition: { field: 'operation', value: 'langsmith_create_run' },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Run name',
      required: { field: 'operation', value: 'langsmith_create_run' },
      condition: { field: 'operation', value: 'langsmith_create_run' },
    },
    {
      id: 'run_type',
      title: 'Run Type',
      type: 'dropdown',
      options: [
        { label: 'Chain', id: 'chain' },
        { label: 'Tool', id: 'tool' },
        { label: 'LLM', id: 'llm' },
        { label: 'Retriever', id: 'retriever' },
        { label: 'Embedding', id: 'embedding' },
        { label: 'Prompt', id: 'prompt' },
        { label: 'Parser', id: 'parser' },
      ],
      value: () => 'chain',
      required: { field: 'operation', value: 'langsmith_create_run' },
      condition: { field: 'operation', value: 'langsmith_create_run' },
    },
    {
      id: 'start_time',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'e.g. 2025-01-01T12:00:00Z (defaults to now)',
      condition: { field: 'operation', value: 'langsmith_create_run' },
    },
    {
      id: 'end_time',
      title: 'End Time',
      type: 'short-input',
      placeholder: '2025-01-01T12:00:30Z',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'inputs',
      title: 'Inputs',
      type: 'code',
      placeholder: '{"input":"value"}',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'outputs',
      title: 'Outputs',
      type: 'code',
      placeholder: '{"output":"value"}',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'extra',
      title: 'Metadata',
      type: 'code',
      placeholder: '{"ls_model":"gpt-4"}',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'code',
      placeholder: '["production","workflow"]',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'parent_run_id',
      title: 'Parent Run ID',
      type: 'short-input',
      placeholder: 'Parent run identifier',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'trace_id',
      title: 'Trace ID',
      type: 'short-input',
      placeholder: 'Auto-generated if blank',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'session_id',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'Session identifier',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'session_name',
      title: 'Session Name',
      type: 'short-input',
      placeholder: 'Session name',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'status',
      title: 'Status',
      type: 'short-input',
      placeholder: 'success',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'error',
      title: 'Error',
      type: 'long-input',
      placeholder: 'Error message',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'dotted_order',
      title: 'Dotted Order',
      type: 'short-input',
      placeholder: 'Defaults to <YYYYMMDDTHHMMSSffffff>Z<id>',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'events',
      title: 'Events',
      type: 'code',
      placeholder: '[{"event":"token","value":1}]',
      condition: { field: 'operation', value: 'langsmith_create_run' },
      mode: 'advanced',
    },
    {
      id: 'post',
      title: 'Post Runs',
      type: 'code',
      placeholder: '[{"id":"...","name":"...","run_type":"chain","start_time":"..."}]',
      condition: { field: 'operation', value: 'langsmith_create_runs_batch' },
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt: `Output ONLY a JSON array with a single LangSmith run object. No explanation.
Required: name (string), run_type ("tool"|"chain"|"llm"|"retriever"|"embedding"|"prompt"|"parser")
Optional: inputs, outputs, tags, extra, session_name, end_time
Fields id, trace_id, dotted_order, start_time are auto-generated if omitted.`,
      },
    },
    {
      id: 'patch',
      title: 'Patch Runs',
      type: 'code',
      placeholder: '[{"id":"...","name":"...","run_type":"chain","start_time":"..."}]',
      condition: { field: 'operation', value: 'langsmith_create_runs_batch' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        prompt: `Output ONLY a JSON array with a single LangSmith run object to update. No explanation.
Required: id (existing run UUID), name, run_type ("tool"|"chain"|"llm"|"retriever"|"embedding"|"prompt"|"parser")
Common patch fields: outputs, end_time, status, error`,
      },
    },
  ],
  tools: {
    access: ['langsmith_create_run', 'langsmith_create_runs_batch'],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const parseJsonValue = (value: unknown, label: string) => {
          if (value === undefined || value === null || value === '') {
            return undefined
          }
          if (typeof value === 'string') {
            try {
              return JSON.parse(value)
            } catch (error) {
              throw new Error(`Invalid JSON for ${label}: ${toError(error).message}`)
            }
          }
          return value
        }

        if (params.operation === 'langsmith_create_runs_batch') {
          const post = parseJsonValue(params.post, 'post runs')
          const patch = parseJsonValue(params.patch, 'patch runs')

          if (!post && !patch) {
            throw new Error('Provide at least one of post or patch runs')
          }

          return {
            apiKey: params.apiKey,
            post,
            patch,
          }
        }

        return {
          apiKey: params.apiKey,
          id: params.id,
          name: params.name,
          run_type: params.run_type,
          start_time: params.start_time,
          end_time: params.end_time,
          inputs: parseJsonValue(params.inputs, 'inputs'),
          run_outputs: parseJsonValue(params.outputs, 'outputs'),
          extra: parseJsonValue(params.extra, 'metadata'),
          tags: parseJsonValue(params.tags, 'tags'),
          parent_run_id: params.parent_run_id,
          trace_id: params.trace_id,
          session_id: params.session_id,
          session_name: params.session_name,
          status: params.status,
          error: params.error,
          dotted_order: params.dotted_order,
          events: parseJsonValue(params.events, 'events'),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'LangSmith API key' },
    id: { type: 'string', description: 'Run identifier' },
    name: { type: 'string', description: 'Run name' },
    run_type: { type: 'string', description: 'Run type' },
    start_time: { type: 'string', description: 'Run start time (ISO)' },
    end_time: { type: 'string', description: 'Run end time (ISO)' },
    inputs: { type: 'json', description: 'Run inputs payload' },
    outputs: { type: 'json', description: 'Run outputs payload' },
    extra: { type: 'json', description: 'Additional metadata (extra)' },
    tags: { type: 'json', description: 'Tags array' },
    parent_run_id: { type: 'string', description: 'Parent run ID' },
    trace_id: { type: 'string', description: 'Trace ID' },
    session_id: { type: 'string', description: 'Session ID' },
    session_name: { type: 'string', description: 'Session name' },
    status: { type: 'string', description: 'Run status' },
    error: { type: 'string', description: 'Error message' },
    dotted_order: { type: 'string', description: 'Dotted order string' },
    events: { type: 'json', description: 'Events array' },
    post: { type: 'json', description: 'Runs to ingest in batch' },
    patch: { type: 'json', description: 'Runs to update in batch' },
  },
  outputs: {
    accepted: { type: 'boolean', description: 'Whether ingestion was accepted' },
    runId: { type: 'string', description: 'Run ID for single run' },
    runIds: { type: 'array', description: 'Run IDs for batch ingest' },
    message: { type: 'string', description: 'LangSmith response message' },
    messages: { type: 'array', description: 'Per-run response messages' },
  },
}

export const LangsmithBlockMeta = {
  tags: ['monitoring', 'llm'],
  url: 'https://www.langchain.com/langsmith',
  templates: [
    {
      icon: LangsmithIcon,
      title: 'LangSmith agent-run tracer',
      prompt:
        'Build a workflow that wraps an agent step and forwards each run to LangSmith with inputs, outputs, and latency so the ML team can trace executions in one project.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
    },
    {
      icon: LangsmithIcon,
      title: 'LangSmith error logger',
      prompt:
        'Create a workflow that on a failed agent step forwards a LangSmith run tagged as an error with the inputs and error message, and posts the run link to Slack for the ML team.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LangsmithIcon,
      title: 'LangSmith feedback capture',
      prompt:
        'Build a workflow that collects user-reported agent failures from a table and forwards each as a tagged LangSmith run with the inputs and expected output for later review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: LangsmithIcon,
      title: 'LangSmith batch run shipper',
      prompt:
        'Create a scheduled workflow that reads completed agent runs from a table and posts them to LangSmith in a single batch so observability stays in sync without per-run overhead.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
    },
    {
      icon: LangsmithIcon,
      title: 'LangSmith session tagger',
      prompt:
        'Build a workflow that forwards each agent run to LangSmith tagged with the originating feature and environment so traces can be filtered by surface in the LangSmith project.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops'],
    },
    {
      icon: LangsmithIcon,
      title: 'LangSmith RAG step logger',
      prompt:
        'Create a workflow that runs a retrieval-augmented agent and forwards a LangSmith run per step — retriever, prompt, and llm — so the ML team can inspect each stage of the chain.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: LangsmithIcon,
      title: 'LangSmith multi-agent tracer',
      prompt:
        'Build a workflow that forwards a LangSmith run for each agent in a multi-step pipeline under one trace, so the full conversation is visible end-to-end in LangSmith.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'log-llm-run-to-langsmith',
      description:
        'Send a single LLM or chain run to LangSmith with inputs, outputs, and timing for tracing.',
      content:
        '# Log an LLM Run to LangSmith\n\nForward one workflow step into LangSmith so it shows up in tracing and evals.\n\n## Steps\n1. Capture the run name, run type (llm, chain, tool), and the project to log into.\n2. Record the inputs (prompt or arguments) and the outputs the step produced.\n3. Include start and end times so latency is captured, plus any error if the step failed.\n4. Create the run in LangSmith.\n\n## Output\nConfirm the run was logged with its name, type, and project, and surface the run ID for follow-up inspection.',
    },
    {
      name: 'batch-export-runs',
      description:
        'Send a batch of completed workflow runs to LangSmith in one call for observability.',
      content:
        '# Batch Export Runs\n\nShip multiple completed runs to LangSmith at once instead of one by one.\n\n## Steps\n1. Collect the runs to export, each with name, type, inputs, outputs, and timing.\n2. Assign a shared project so the runs land together.\n3. Submit them as a single batch.\n\n## Output\nReturn how many runs were exported, the project they landed in, and any runs that failed validation.',
    },
  ],
} as const satisfies BlockMeta
