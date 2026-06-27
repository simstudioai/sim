import { HuggingFaceIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const HuggingFaceBlockDisplay = {
  type: 'huggingface',
  name: 'Hugging Face',
  description: 'Use Hugging Face Inference API',
  category: 'tools',
  bgColor: '#0B0F19',
  icon: HuggingFaceIcon,
  longDescription:
    'Integrate Hugging Face into the workflow. Can generate completions using the Hugging Face Inference API.',
  docsLink: 'https://docs.sim.ai/integrations/huggingface',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay

export const HuggingFaceBlockMeta = {
  tags: ['llm', 'agentic'],
  url: 'https://huggingface.co',
  templates: [
    {
      icon: HuggingFaceIcon,
      title: 'Hugging Face row classifier',
      prompt:
        'Build a workflow that runs each row in a table through a Hugging Face chat model with custom labels in the prompt, writes the predicted label and a confidence rating back, and flags low-confidence rows for review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'automation'],
    },
    {
      icon: HuggingFaceIcon,
      title: 'Open-source sentiment scorer',
      prompt:
        'Create a workflow that scores customer feedback with a Hugging Face chat model, writes sentiment and score columns back to the table, and pings Slack on a sudden negative spike.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HuggingFaceIcon,
      title: 'Hugging Face candidate reranker',
      prompt:
        'Create a retrieval pipeline that fetches top-50 candidates from a knowledge base, reranks them with a Hugging Face chat model scoring relevance, and returns the top-5 to the answering agent for higher precision.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: HuggingFaceIcon,
      title: 'Hugging Face PII redactor',
      prompt:
        'Build a workflow that runs a Hugging Face chat model over text uploads to detect PII, redacts the sensitive entities, and writes the cleaned text to a downstream table.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'automation'],
    },
    {
      icon: HuggingFaceIcon,
      title: 'Hugging Face open-model summarizer',
      prompt:
        'Create a workflow that on a new document fetches the text and runs it through a Hugging Face chat model to produce a concise summary and key takeaways, then writes the result back to a table — keeping the workload on open-weight models you control.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['llm', 'content', 'automation'],
    },
    {
      icon: HuggingFaceIcon,
      title: 'Hugging Face feedback classifier',
      prompt:
        'Build a workflow that reads new customer feedback rows, uses a Hugging Face chat model to classify sentiment and theme, writes the labels back to the table, and posts a Slack alert when negative feedback spikes.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'llm', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HuggingFaceIcon,
      title: 'Hugging Face model A/B harness',
      prompt:
        'Create a workflow that runs the same prompt through a Hugging Face open model and a hosted model side by side, compares the outputs with a grading agent, and logs quality, latency, and cost to a table for evaluation.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['llm', 'engineering', 'analysis'],
    },
  ],
  skills: [
    {
      name: 'run-chat-completion',
      description:
        'Send a prompt to a Hugging Face chat model via the Inference API and return the response.',
      content:
        '# Run Chat Completion\n\nGenerate a completion from an open chat model.\n\n## Steps\n1. Choose the model (e.g. an instruct or chat-tuned model available via the Inference API).\n2. Build the messages with a clear system instruction and the user prompt.\n3. Call chat with the model and messages, setting temperature and max tokens appropriate to the task.\n4. Capture the assistant response and any token usage returned.\n\n## Output\nReturn the model output and the model name used. Note token usage when available for cost tracking.',
    },
    {
      name: 'extract-structured-data',
      description:
        'Use a Hugging Face chat model to extract fields from unstructured text into a structured object.',
      content:
        '# Extract Structured Data\n\nPull named fields out of free text using an open model.\n\n## Steps\n1. Define the exact fields to extract and their types.\n2. Build a system message instructing the model to return only valid JSON matching the schema, with nulls for missing fields.\n3. Call chat with the source text as the user message and a low temperature for determinism.\n4. Parse the response and validate it against the expected fields; retry once with a stricter instruction if parsing fails.\n\n## Output\nReturn the parsed structured object. On repeated parse failure, return the raw model text and an error note.',
    },
    {
      name: 'compare-model-outputs',
      description: 'Run the same prompt through two Hugging Face models and compare their outputs.',
      content:
        '# Compare Model Outputs\n\nEvaluate how two open models handle the same task.\n\n## Steps\n1. Define the shared prompt and the two model identifiers to compare.\n2. Call chat once per model with identical messages and generation settings.\n3. Capture each output along with latency and token usage.\n4. Score the outputs against the task criteria (accuracy, format, completeness).\n\n## Output\nReturn both responses side by side with their latency, token usage, and a brief quality comparison. Suitable for logging to an evaluation table.',
    },
  ],
} as const satisfies BlockMeta
