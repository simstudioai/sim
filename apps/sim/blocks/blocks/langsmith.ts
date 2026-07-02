import { toError } from '@sim/utils/errors'
import { LangsmithIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { LangsmithResponse } from '@/tools/langsmith/types'

export const LangsmithBlock: BlockConfig<LangsmithResponse> = {
  type: 'langsmith',
  name: 'LangSmith',
  description: 'Forward workflow runs to LangSmith for observability',
  longDescription:
    'Send run data to LangSmith to trace executions, attach metadata, and monitor workflow performance.',
  docsLink: 'https://docs.sim.ai/integrations/langsmith',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#181C1E',
  icon: LangsmithIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Run', id: 'langsmith_create_run' },
        { label: 'Create Runs Batch', id: 'langsmith_create_runs_batch' },
        { label: 'Update Run', id: 'langsmith_update_run' },
        { label: 'Get Run', id: 'langsmith_get_run' },
        { label: 'Create Feedback', id: 'langsmith_create_feedback' },
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
      id: 'runId',
      title: 'Run ID',
      type: 'short-input',
      placeholder: 'ID of the run to update, retrieve, or attach feedback to',
      required: {
        field: 'operation',
        value: ['langsmith_update_run', 'langsmith_get_run', 'langsmith_create_feedback'],
      },
      condition: {
        field: 'operation',
        value: ['langsmith_update_run', 'langsmith_get_run', 'langsmith_create_feedback'],
      },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Run name',
      required: { field: 'operation', value: 'langsmith_create_run' },
      condition: { field: 'operation', value: ['langsmith_create_run', 'langsmith_update_run'] },
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
      condition: { field: 'operation', value: ['langsmith_create_run', 'langsmith_update_run'] },
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
      condition: { field: 'operation', value: ['langsmith_create_run', 'langsmith_update_run'] },
      mode: 'advanced',
    },
    {
      id: 'extra',
      title: 'Metadata',
      type: 'code',
      placeholder: '{"ls_model":"gpt-4"}',
      condition: { field: 'operation', value: ['langsmith_create_run', 'langsmith_update_run'] },
      mode: 'advanced',
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'code',
      placeholder: '["production","workflow"]',
      condition: { field: 'operation', value: ['langsmith_create_run', 'langsmith_update_run'] },
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
      condition: { field: 'operation', value: ['langsmith_create_run', 'langsmith_update_run'] },
      mode: 'advanced',
    },
    {
      id: 'error',
      title: 'Error',
      type: 'long-input',
      placeholder: 'Error message',
      condition: { field: 'operation', value: ['langsmith_create_run', 'langsmith_update_run'] },
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
      condition: { field: 'operation', value: ['langsmith_create_run', 'langsmith_update_run'] },
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
    {
      id: 'key',
      title: 'Feedback Key',
      type: 'short-input',
      placeholder: 'e.g. correctness, user_score',
      required: { field: 'operation', value: 'langsmith_create_feedback' },
      condition: { field: 'operation', value: 'langsmith_create_feedback' },
    },
    {
      id: 'score',
      title: 'Score',
      type: 'short-input',
      placeholder: 'e.g. 1, 0.5, 0',
      condition: { field: 'operation', value: 'langsmith_create_feedback' },
    },
    {
      id: 'value',
      title: 'Value',
      type: 'short-input',
      placeholder: 'e.g. good, bad',
      condition: { field: 'operation', value: 'langsmith_create_feedback' },
      mode: 'advanced',
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Explanation for the feedback',
      condition: { field: 'operation', value: 'langsmith_create_feedback' },
      mode: 'advanced',
    },
    {
      id: 'correction',
      title: 'Correction',
      type: 'code',
      placeholder: '{"output":"the corrected value"}',
      condition: { field: 'operation', value: 'langsmith_create_feedback' },
      mode: 'advanced',
    },
    {
      id: 'feedbackSourceType',
      title: 'Feedback Source',
      type: 'dropdown',
      options: [
        { label: 'API', id: 'api' },
        { label: 'App', id: 'app' },
        { label: 'Model', id: 'model' },
      ],
      condition: { field: 'operation', value: 'langsmith_create_feedback' },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'langsmith_create_run',
      'langsmith_create_runs_batch',
      'langsmith_update_run',
      'langsmith_get_run',
      'langsmith_create_feedback',
    ],
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

        if (params.operation === 'langsmith_update_run') {
          const name = params.name
          const end_time = params.end_time
          const outputs = parseJsonValue(params.outputs, 'outputs')
          const extra = parseJsonValue(params.extra, 'metadata')
          const tags = parseJsonValue(params.tags, 'tags')
          const status = params.status
          const error = params.error
          const events = parseJsonValue(params.events, 'events')

          if (
            [name, end_time, outputs, extra, tags, status, error, events].every(
              (value) => value === undefined
            )
          ) {
            throw new Error('Provide at least one field to update')
          }

          return {
            apiKey: params.apiKey,
            runId: params.runId,
            name,
            end_time,
            outputs,
            extra,
            tags,
            status,
            error,
            events,
          }
        }

        if (params.operation === 'langsmith_get_run') {
          return {
            apiKey: params.apiKey,
            runId: params.runId,
          }
        }

        if (params.operation === 'langsmith_create_feedback') {
          const parseScore = (value: unknown) => {
            if (value === undefined || value === null || value === '') {
              return undefined
            }
            const parsed = Number(value)
            if (Number.isNaN(parsed)) {
              throw new Error(`Invalid score: "${value}" is not a number`)
            }
            return parsed
          }

          return {
            apiKey: params.apiKey,
            runId: params.runId,
            key: params.key,
            score: parseScore(params.score),
            value: params.value,
            comment: params.comment,
            correction: parseJsonValue(params.correction, 'correction'),
            feedbackSourceType: params.feedbackSourceType || undefined,
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
    runId: {
      type: 'string',
      description: 'ID of the run to update, retrieve, or attach feedback to',
    },
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
    key: { type: 'string', description: 'Feedback metric name' },
    score: { type: 'string', description: 'Numeric score for the feedback metric' },
    value: { type: 'string', description: 'Categorical value for the feedback metric' },
    comment: { type: 'string', description: 'Comment explaining the feedback' },
    correction: { type: 'json', description: 'Corrected output for the run' },
    feedbackSourceType: {
      type: 'string',
      description: 'Origin of the feedback (api, app, or model)',
    },
  },
  outputs: {
    accepted: { type: 'boolean', description: 'Whether ingestion or the update was accepted' },
    runId: { type: 'string', description: 'Run ID for single-run operations' },
    runIds: { type: 'array', description: 'Run IDs for batch ingest' },
    message: { type: 'string', description: 'LangSmith response message' },
    messages: { type: 'array', description: 'Per-run response messages' },
    id: { type: 'string', description: 'Run ID (get run) or feedback ID (create feedback)' },
    name: { type: 'string', description: 'Run name (get run)' },
    runType: { type: 'string', description: 'Run type (get run)' },
    status: { type: 'string', description: 'Run status (get run)' },
    startTime: { type: 'string', description: 'Run start time (get run)' },
    endTime: { type: 'string', description: 'Run end time (get run)' },
    inputs: { type: 'json', description: 'Run inputs payload (get run)' },
    outputs: { type: 'json', description: 'Run outputs payload (get run)' },
    error: { type: 'string', description: 'Error details (get run)' },
    tags: { type: 'array', description: 'Tags attached to the run (get run)' },
    sessionId: { type: 'string', description: 'Project (session) ID the run belongs to (get run)' },
    traceId: { type: 'string', description: 'Trace ID (get run)' },
    parentRunId: { type: 'string', description: 'Parent run ID (get run)' },
    totalTokens: { type: 'number', description: 'Total tokens consumed by the run (get run)' },
    totalCost: { type: 'string', description: 'Total cost of the run (get run)' },
    key: { type: 'string', description: 'Feedback metric name (create feedback)' },
    score: { type: 'number', description: 'Score recorded for the feedback (create feedback)' },
    value: {
      type: 'string',
      description: 'Categorical value recorded for the feedback (create feedback)',
    },
    comment: { type: 'string', description: 'Comment recorded for the feedback (create feedback)' },
    createdAt: { type: 'string', description: 'When the feedback was created (create feedback)' },
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
        'Build a workflow that collects user-reported agent failures from a table and attaches each as scored LangSmith feedback on the originating run for later review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: LangsmithIcon,
      title: 'LangSmith run completion',
      prompt:
        'Build a workflow that creates a LangSmith run when an agent step starts, then updates it with outputs, status, and end time once the step finishes so traces always show the full lifecycle.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
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
    {
      name: 'attach-feedback-to-run',
      description:
        'Attach a score, categorical value, or correction to an existing LangSmith run for evaluation.',
      content:
        '# Attach Feedback to a Run\n\nRecord a human or automated judgment on a run that already exists in LangSmith.\n\n## Steps\n1. Identify the run ID the feedback applies to.\n2. Choose a feedback key (e.g. "correctness", "user_score") and a score, value, or comment.\n3. Include a correction if the expected output is known.\n4. Submit the feedback.\n\n## Output\nConfirm the feedback ID and the run it was attached to.',
    },
  ],
} as const satisfies BlockMeta
