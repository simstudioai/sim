import { HuggingFaceIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { HuggingFaceChatResponse } from '@/tools/huggingface/types'

export const HuggingFaceBlock: BlockConfig<HuggingFaceChatResponse> = {
  type: 'huggingface',
  name: 'Hugging Face',
  description: 'Use Hugging Face Inference API',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Hugging Face into the workflow. Can generate completions using the Hugging Face Inference API.',
  docsLink: 'https://docs.sim.ai/tools/huggingface',
  category: 'tools',
  integrationType: IntegrationType.AI,
  bgColor: '#0B0F19',
  icon: HuggingFaceIcon,
  subBlocks: [
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      placeholder: 'Enter system prompt to guide the model behavior...',
      rows: 3,
    },
    {
      id: 'content',
      title: 'User Prompt',
      type: 'long-input',
      required: true,
      placeholder: 'Enter your message here...',
      rows: 3,
    },
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Novita', id: 'novita' },
        { label: 'Cerebras', id: 'cerebras' },
        { label: 'Cohere', id: 'cohere' },
        { label: 'Fal AI', id: 'fal' },
        { label: 'Fireworks', id: 'fireworks' },
        { label: 'Hyperbolic', id: 'hyperbolic' },
        { label: 'HF Inference', id: 'hf-inference' },
        { label: 'Nebius', id: 'nebius' },
        { label: 'Nscale', id: 'nscale' },
        { label: 'Replicate', id: 'replicate' },
        { label: 'SambaNova', id: 'sambanova' },
        { label: 'Together', id: 'together' },
      ],
      value: () => 'novita',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'short-input',
      required: true,
      placeholder:
        'e.g., deepseek/deepseek-v3-0324, llama3.1-8b, meta-llama/Llama-3.2-3B-Instruct-Turbo',
      description: 'The model must be available for the selected provider.',
      dependsOn: ['provider'],
    },
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'slider',
      min: 0,
      max: 2,
      value: () => '0.7',
    },
    {
      id: 'maxTokens',
      title: 'Max Tokens',
      type: 'short-input',
      placeholder: 'e.g., 1000',
    },
    {
      id: 'apiKey',
      title: 'API Token',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Hugging Face API token',
      password: true,
    },
  ],
  tools: {
    access: ['huggingface_chat'],
    config: {
      tool: () => 'huggingface_chat',
      params: (params) => {
        const toolParams = {
          apiKey: params.apiKey,
          provider: params.provider,
          model: params.model,
          content: params.content,
          systemPrompt: params.systemPrompt,
          temperature: params.temperature ? Number.parseFloat(params.temperature) : undefined,
          maxTokens: params.maxTokens ? Number.parseInt(params.maxTokens) : undefined,
          stream: false, // Always false
        }

        return toolParams
      },
    },
  },
  inputs: {
    systemPrompt: { type: 'string', description: 'System instructions' },
    content: { type: 'string', description: 'User message content' },
    provider: { type: 'string', description: 'Model provider' },
    model: { type: 'string', description: 'Model identifier' },
    temperature: { type: 'string', description: 'Response randomness' },
    maxTokens: { type: 'string', description: 'Maximum output tokens' },
    apiKey: { type: 'string', description: 'API access token' },
  },
  outputs: {
    content: { type: 'string', description: 'Generated response' },
    model: { type: 'string', description: 'Model used' },
    usage: { type: 'json', description: 'Token usage stats' },
  },
}

export const HuggingFaceBlockMeta = {
  tags: ['llm', 'agentic'],
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
} as const satisfies BlockMeta
