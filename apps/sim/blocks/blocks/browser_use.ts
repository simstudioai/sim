import { BrowserUseIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'
import type { BrowserUseResponse } from '@/tools/browser_use/types'

export const BrowserUseBlock: BlockConfig<BrowserUseResponse> = {
  type: 'browser_use',
  name: 'Browser Use',
  description: 'Run browser automation tasks',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Browser Use into the workflow. Can navigate the web and perform actions as if a real user was interacting with the browser.',
  docsLink: 'https://docs.sim.ai/tools/browser_use',
  category: 'tools',
  integrationType: IntegrationType.AI,
  tags: ['web-scraping', 'automation', 'agentic'],
  bgColor: '#181C1E',
  icon: BrowserUseIcon,
  subBlocks: [
    {
      id: 'task',
      title: 'Task',
      type: 'long-input',
      placeholder: 'Describe what the browser agent should do...',
      required: true,
    },
    {
      id: 'startUrl',
      title: 'Start URL',
      type: 'short-input',
      placeholder: 'https://example.com (optional starting URL)',
    },
    {
      id: 'variables',
      title: 'Variables (Secrets)',
      type: 'table',
      columns: ['Key', 'Value'],
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'Browser Use LLM', id: 'browser-use-llm' },
        { label: 'Browser Use 2.0', id: 'browser-use-2.0' },
        { label: 'GPT-4o', id: 'gpt-4o' },
        { label: 'GPT-4o Mini', id: 'gpt-4o-mini' },
        { label: 'GPT-4.1', id: 'gpt-4.1' },
        { label: 'GPT-4.1 Mini', id: 'gpt-4.1-mini' },
        { label: 'O3', id: 'o3' },
        { label: 'O4 Mini', id: 'o4-mini' },
        { label: 'Gemini 2.5 Flash', id: 'gemini-2.5-flash' },
        { label: 'Gemini 2.5 Pro', id: 'gemini-2.5-pro' },
        { label: 'Gemini 3 Pro Preview', id: 'gemini-3-pro-preview' },
        { label: 'Gemini 3 Flash Preview', id: 'gemini-3-flash-preview' },
        { label: 'Gemini Flash Latest', id: 'gemini-flash-latest' },
        { label: 'Gemini Flash Lite Latest', id: 'gemini-flash-lite-latest' },
        { label: 'Claude 3.7 Sonnet', id: 'claude-3-7-sonnet-20250219' },
        { label: 'Claude Sonnet 4', id: 'claude-sonnet-4-20250514' },
        { label: 'Claude Sonnet 4.5', id: 'claude-sonnet-4-5-20250929' },
        { label: 'Claude Sonnet 4.6', id: 'claude-sonnet-4-6' },
        { label: 'Claude Opus 4.5', id: 'claude-opus-4-5-20251101' },
        { label: 'Llama 4 Maverick', id: 'llama-4-maverick-17b-128e-instruct' },
      ],
    },
    {
      id: 'profile_id',
      title: 'Profile ID',
      type: 'short-input',
      placeholder: 'Enter browser profile ID (optional)',
    },
    {
      id: 'maxSteps',
      title: 'Max Steps',
      type: 'short-input',
      placeholder: '100',
      mode: 'advanced',
    },
    {
      id: 'allowedDomains',
      title: 'Allowed Domains',
      type: 'short-input',
      placeholder: 'example.com, docs.example.com',
      mode: 'advanced',
    },
    {
      id: 'vision',
      title: 'Vision',
      type: 'dropdown',
      options: [
        { label: 'Auto (default)', id: 'auto' },
        { label: 'Enabled', id: 'true' },
        { label: 'Disabled', id: 'false' },
      ],
      mode: 'advanced',
    },
    {
      id: 'flashMode',
      title: 'Flash Mode',
      type: 'switch',
      placeholder: 'Faster but less careful navigation',
      mode: 'advanced',
    },
    {
      id: 'thinking',
      title: 'Thinking',
      type: 'switch',
      placeholder: 'Enable extended reasoning',
      mode: 'advanced',
    },
    {
      id: 'highlightElements',
      title: 'Highlight Elements',
      type: 'switch',
      placeholder: 'Visually mark interactive elements',
      mode: 'advanced',
    },
    {
      id: 'systemPromptExtension',
      title: 'System Prompt Extension',
      type: 'long-input',
      placeholder: 'Append custom instructions to the agent system prompt (max 2000 chars)',
      mode: 'advanced',
    },
    {
      id: 'structuredOutput',
      title: 'Structured Output Schema',
      type: 'code',
      language: 'json',
      placeholder: 'Stringified JSON schema for structured output',
      mode: 'advanced',
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'table',
      columns: ['Key', 'Value'],
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your BrowserUse API key',
      required: true,
    },
  ],
  tools: {
    access: ['browser_use_run_task'],
    config: {
      tool: () => 'browser_use_run_task',
      params: (params) => {
        const next: Record<string, any> = { ...params }
        if (typeof next.maxSteps === 'string') {
          const trimmed = next.maxSteps.trim()
          if (trimmed === '') {
            next.maxSteps = undefined
          } else {
            const n = Number(trimmed)
            next.maxSteps = Number.isFinite(n) ? n : undefined
          }
        }
        if (next.vision === 'true') next.vision = true
        else if (next.vision === 'false') next.vision = false
        if (next.metadata && Array.isArray(next.metadata)) {
          const obj: Record<string, string> = {}
          for (const row of next.metadata as Array<Record<string, any>>) {
            const key = row?.cells?.Key ?? row?.Key
            const value = row?.cells?.Value ?? row?.Value
            if (key) obj[key] = String(value ?? '')
          }
          next.metadata = obj
        }
        return next
      },
    },
  },
  inputs: {
    task: { type: 'string', description: 'Browser automation task' },
    startUrl: { type: 'string', description: 'Starting URL for the agent' },
    apiKey: { type: 'string', description: 'BrowserUse API key' },
    variables: { type: 'json', description: 'Secrets to inject into the task' },
    model: { type: 'string', description: 'LLM model to use' },
    profile_id: { type: 'string', description: 'Browser profile ID for persistent sessions' },
    maxSteps: { type: 'number', description: 'Maximum agent steps' },
    allowedDomains: { type: 'string', description: 'Comma-separated allowed domains' },
    vision: { type: 'string', description: 'Vision capability (auto / true / false)' },
    flashMode: { type: 'boolean', description: 'Enable flash mode' },
    thinking: { type: 'boolean', description: 'Enable extended reasoning' },
    highlightElements: { type: 'boolean', description: 'Highlight interactive elements' },
    systemPromptExtension: { type: 'string', description: 'Custom system prompt extension' },
    structuredOutput: { type: 'string', description: 'Stringified JSON schema' },
    metadata: { type: 'json', description: 'Custom key-value metadata' },
  },
  outputs: {
    id: { type: 'string', description: 'Task execution identifier' },
    success: { type: 'boolean', description: 'Task completion status' },
    output: { type: 'json', description: 'Final task output (string or structured)' },
    steps: {
      type: 'json',
      description:
        'Steps the agent executed (number, memory, evaluationPreviousGoal, nextGoal, url, screenshotUrl, actions, duration)',
    },
    liveUrl: {
      type: 'string',
      description: 'Embeddable live browser session URL (active during execution)',
    },
    shareUrl: {
      type: 'string',
      description: 'Public shareable URL for the session (post-run)',
    },
    sessionId: { type: 'string', description: 'Browser Use session identifier' },
  },
}
