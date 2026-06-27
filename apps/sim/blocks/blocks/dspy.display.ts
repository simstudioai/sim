import { DsPyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DSPyBlockDisplay = {
  type: 'dspy',
  name: 'DSPy',
  description: 'Run predictions using self-hosted DSPy programs',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: DsPyIcon,
  longDescription:
    'Integrate with your self-hosted DSPy programs for LLM-powered predictions. Supports Predict, Chain of Thought, and ReAct agents. DSPy is the framework for programming—not prompting—language models.',
  docsLink: 'https://docs.sim.ai/integrations/dspy',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

export const DSPyBlockMeta = {
  tags: ['llm', 'agentic', 'automation'],
  url: 'https://dspy.ai',
  templates: [
    {
      icon: DsPyIcon,
      title: 'DSPy structured extraction',
      prompt:
        'Build a workflow that reads raw records from a table, runs a DSPy predict program on your self-hosted server to extract structured fields from each, and writes the typed results back to the table.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: DsPyIcon,
      title: 'DSPy evaluation harness',
      prompt:
        'Create a workflow that runs a DSPy program against a labeled evals table, computes accuracy, F1, and per-class breakdowns, and writes the metrics to a reporting table for tracking over iterations.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: DsPyIcon,
      title: 'DSPy A/B program selector',
      prompt:
        'Create a scheduled workflow that runs two DSPy program endpoints against the same eval set nightly, scores each on accuracy, and writes the head-to-head comparison and recommended winner to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: DsPyIcon,
      title: 'DSPy production traffic replay',
      prompt:
        'Build a workflow that periodically replays sample production traces through a DSPy program, captures divergences, and writes regression analysis to a tracking file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: DsPyIcon,
      title: 'DSPy + LangSmith trace harness',
      prompt:
        'Create a workflow that runs a DSPy program over an eval set, logs each prediction as a LangSmith trace for evaluation, captures the quality delta against the previous run, and writes the comparison to engineering Slack.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['langsmith', 'slack'],
    },
    {
      icon: DsPyIcon,
      title: 'DSPy ticket classifier',
      prompt:
        'Build a workflow that runs new support tickets through a DSPy predict signature to classify category, urgency, and sentiment with structured outputs, then routes each ticket to the right queue and writes the labels back to the ticket.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'llm'],
    },
    {
      icon: DsPyIcon,
      title: 'DSPy reasoning research agent',
      prompt:
        'Create a workflow that takes a research question, uses DSPy chain-of-thought to break it into sub-questions, runs DSPy ReAct with web search to gather evidence, and writes a structured, cited answer to a file.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['research', 'llm', 'agentic'],
    },
  ],
  skills: [
    {
      name: 'run-dspy-prediction',
      description:
        'Call a self-hosted DSPy Predict program to get a structured output from an input.',
      content:
        '# Run DSPy Prediction\n\nSend input to a self-hosted DSPy Predict program and return its structured answer.\n\n## Steps\n1. Confirm the DSPy server base URL and, if required, the API key.\n2. Choose the Predict operation and supply the input text. Set the input field name only if the program signature expects something other than the default.\n3. Pass any extra signature fields as an additional-inputs JSON object.\n\n## Output\nReturn the program answer and any structured fields it produced. If the server returns a non-success status, surface the status and the raw output for debugging.',
    },
    {
      name: 'reason-with-chain-of-thought',
      description:
        'Use a DSPy Chain of Thought program to answer a question with explicit reasoning.',
      content:
        '# Reason with Chain of Thought\n\nAnswer a question through a self-hosted DSPy Chain of Thought program that exposes its reasoning.\n\n## Steps\n1. Confirm the DSPy server base URL and API key if needed.\n2. Choose the Chain of Thought operation and supply the question. Add any background as context.\n3. Run the program and capture both the answer and the reasoning trace.\n\n## Output\nReturn the final answer plus the reasoning rationale so the requester can audit how the conclusion was reached.',
    },
    {
      name: 'run-dspy-react-agent',
      description:
        'Run a DSPy ReAct agent on a task that requires multi-step tool use, and capture its trajectory.',
      content:
        '# Run DSPy ReAct Agent\n\nExecute a task with a self-hosted DSPy ReAct agent that interleaves reasoning and actions.\n\n## Steps\n1. Confirm the DSPy server base URL and API key if needed.\n2. Choose the ReAct operation and describe the task clearly. Set a max-iterations cap to bound how many reasoning-action cycles run.\n3. Provide any needed context, then execute the agent.\n\n## Output\nReturn the final answer and the step-by-step trajectory (thoughts, actions, observations). If the agent hit the iteration cap without finishing, note that and summarize the last state.',
    },
  ],
} as const satisfies BlockMeta
