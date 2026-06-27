import { LangsmithIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const LangsmithBlockDisplay = {
  type: 'langsmith',
  name: 'LangSmith',
  description: 'Forward workflow runs to LangSmith for observability',
  category: 'tools',
  bgColor: '#181C1E',
  icon: LangsmithIcon,
  longDescription:
    'Send run data to LangSmith to trace executions, attach metadata, and monitor workflow performance.',
  docsLink: 'https://docs.sim.ai/integrations/langsmith',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay

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
