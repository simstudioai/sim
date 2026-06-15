import { BrowserUseIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { BrowserUseResponse } from '@/tools/browser_use/types'

export const BrowserUseBlock: BlockConfig<BrowserUseResponse> = {
  type: 'browser_use',
  name: 'Browser Use',
  description: 'Run browser automation tasks',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Browser Use into the workflow. Can navigate the web and perform actions as if a real user was interacting with the browser.',
  docsLink: 'https://docs.sim.ai/integrations/browser_use',
  category: 'tools',
  integrationType: IntegrationType.AI,
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

export const BrowserUseBlockMeta = {
  tags: ['web-scraping', 'automation', 'agentic'],
  url: 'https://browser-use.com',
  templates: [
    {
      icon: BrowserUseIcon,
      title: 'Browser Use form filler',
      prompt:
        'Build a workflow that uses Browser Use to automate filling complex web forms — vendor portals, compliance questionnaires — with data pulled from a table, and captures screenshots to a file as audit trail.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'enterprise'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use competitor pricing scraper',
      prompt:
        'Create a scheduled workflow that runs Browser Use weekly to navigate competitor pricing pages, captures the current plans and prices, diffs against last week, and posts changes to Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use legacy ERP scraper',
      prompt:
        'Create a workflow that uses Browser Use to log into a legacy ERP without an API, exports daily reports, parses them into a table, and posts a summary to Slack so old systems still feed modern ops.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use + Stagehand cross-tool QA',
      prompt:
        'Create a workflow that uses Browser Use and Stagehand together to run scripted browser flows against staging, captures screenshots, and writes a regression report.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['stagehand'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use + Stagehand expense-portal grabber',
      prompt:
        'Build a workflow that uses Browser Use and Stagehand to automate expense-portal data pulls from suppliers, captures the structured data, and writes to a finance table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['stagehand'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use invoice-portal collector',
      prompt:
        'Create a workflow that uses Browser Use to log into vendor invoice portals weekly, downloads outstanding invoices, and writes the metadata to a finance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: BrowserUseIcon,
      title: 'Browser Use review-site monitor',
      prompt:
        'Build a workflow that uses Browser Use to scrape G2 and Capterra review pages for brand mentions, classifies sentiment, and writes notable reviews to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
  ],
  skills: [
    {
      name: 'automate-web-task',
      description:
        'Drive a browser agent to complete a multi-step task on a website, like navigating, clicking, and submitting. Use when a site has no API and a human would normally do the clicks.',
      content:
        '# Automate Web Task\n\nHave the browser agent perform a goal-oriented task on the web.\n\n## Steps\n1. Write a clear, step-by-step Task describing the goal and any success condition (e.g. "log in, open Billing, download the latest invoice").\n2. Set the Start URL so the agent begins on the right page.\n3. Put any credentials or sensitive inputs in Variables (Secrets) and reference them in the task by name rather than pasting them inline.\n4. Restrict Allowed Domains to keep the agent on the intended site, and raise Max Steps for longer flows.\n\n## Output\nReturn whether the task succeeded, the final output, and the share URL for the recorded session so the run can be audited. If the agent gets stuck, report the last step and what blocked it.',
    },
    {
      name: 'extract-structured-data-from-site',
      description:
        'Use a browser agent to navigate a site and return data in a defined JSON schema. Use to pull structured records (prices, listings, table rows) from pages without an API.',
      content:
        '# Extract Structured Data From Site\n\nNavigate a website and return structured data.\n\n## Steps\n1. Write a Task that tells the agent what to find and where (e.g. "go to the pricing page and collect every plan name and monthly price").\n2. Set the Start URL and limit Allowed Domains to the target site.\n3. Provide a Structured Output Schema (stringified JSON schema) describing the exact fields you want back.\n4. Run it; the agent fills the schema from what it observes on the page.\n\n## Output\nReturn the data as objects matching the provided schema. Confirm each field was actually found on the page; if a field could not be located, leave it null and note it rather than fabricating a value.',
    },
    {
      name: 'fill-and-submit-form',
      description:
        'Have a browser agent fill out and submit a web form using supplied field values. Use for vendor portals, questionnaires, or applications that have no API.',
      content:
        '# Fill And Submit Form\n\nComplete a web form end to end.\n\n## Steps\n1. Describe the form and the mapping of values to fields in the Task (e.g. "fill the contact form: name, company, message, then submit").\n2. Set the Start URL to the form page and constrain Allowed Domains.\n3. Pass any private values through Variables (Secrets) so they are injected securely.\n4. Ask the agent to confirm the submission succeeded (look for a success message or confirmation page) before finishing.\n\n## Output\nReturn whether the form submitted successfully, any confirmation text or reference number shown, and the session share URL as an audit trail. If a required field was missing or validation failed, report which field and why.',
    },
  ],
} as const satisfies BlockMeta
