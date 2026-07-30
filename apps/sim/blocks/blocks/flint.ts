import { FlintIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

/**
 * Coerces the publish switch value to an explicit boolean, preserving an
 * explicit false so Flint never falls back to its server-side default.
 * Returns undefined only when the value was never set.
 */
function coercePublish(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

export const FlintBlock: BlockConfig = {
  type: 'flint',
  name: 'Flint',
  description: 'Run background agent tasks on your Flint sites',
  longDescription:
    'Create background agent tasks that modify your Flint sites from natural-language prompts, generate batches of pages from a template, and check task status and results.',
  docsLink: 'https://docs.sim.ai/integrations/flint',
  category: 'tools',
  integrationType: IntegrationType.Marketing,
  bgColor: '#F6F54F',
  icon: FlintIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Task', id: 'flint_create_task' },
        { label: 'Generate Pages', id: 'flint_generate_pages' },
        { label: 'Get Task', id: 'flint_get_task' },
      ],
      value: () => 'flint_create_task',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Your Flint API key (ak_...)',
      password: true,
      required: true,
    },
    {
      id: 'siteId',
      title: 'Site ID',
      type: 'short-input',
      placeholder: 'ID of the Flint site to modify',
      condition: {
        field: 'operation',
        value: ['flint_create_task', 'flint_generate_pages'],
      },
      required: {
        field: 'operation',
        value: ['flint_create_task', 'flint_generate_pages'],
      },
    },
    {
      id: 'prompt',
      title: 'Prompt',
      type: 'long-input',
      placeholder: 'e.g. Add a new About page with a team section',
      condition: { field: 'operation', value: 'flint_create_task' },
      required: { field: 'operation', value: 'flint_create_task' },
    },
    {
      id: 'templatePageSlug',
      title: 'Template Page Slug',
      type: 'short-input',
      placeholder: '/case-studies/template',
      condition: { field: 'operation', value: 'flint_generate_pages' },
      required: { field: 'operation', value: 'flint_generate_pages' },
    },
    {
      id: 'items',
      title: 'Pages (JSON)',
      type: 'code',
      language: 'json',
      placeholder: `[
  {
    "targetPageSlug": "/case-studies/acme-corp",
    "context": "Company: Acme Corp. Industry: Manufacturing..."
  }
]`,
      condition: { field: 'operation', value: 'flint_generate_pages' },
      required: { field: 'operation', value: 'flint_generate_pages' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of pages to create from a Flint template based on the user's description.
Each page object must have exactly these fields:
- "targetPageSlug": The slug for the new page (e.g., "/case-studies/acme-corp")
- "context": Content details the agent should use to fill in the template

The array must contain between 1 and 10 items.
Return ONLY the raw JSON array starting with [ and ending with ] - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the pages you want to generate...',
      },
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'The task ID returned when the task was created',
      condition: { field: 'operation', value: 'flint_get_task' },
      required: { field: 'operation', value: 'flint_get_task' },
    },
    {
      id: 'publish',
      title: 'Publish on Completion',
      type: 'switch',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['flint_create_task', 'flint_generate_pages'],
      },
    },
    {
      id: 'callbackUrl',
      title: 'Callback URL',
      type: 'short-input',
      placeholder: 'https://your-server.com/webhooks/flint',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['flint_create_task', 'flint_generate_pages'],
      },
    },
  ],

  tools: {
    access: ['flint_create_task', 'flint_generate_pages', 'flint_get_task'],
    config: {
      tool: (params) => params.operation || 'flint_create_task',
      params: (params) => {
        const base: Record<string, unknown> = { apiKey: params.apiKey }

        switch (params.operation) {
          case 'flint_generate_pages':
            return {
              ...base,
              siteId: params.siteId,
              templatePageSlug: params.templatePageSlug,
              items: params.items,
              callbackUrl: params.callbackUrl || undefined,
              publish: coercePublish(params.publish),
            }
          case 'flint_get_task':
            return { ...base, taskId: params.taskId }
          default:
            return {
              ...base,
              siteId: params.siteId,
              prompt: params.prompt,
              callbackUrl: params.callbackUrl || undefined,
              publish: coercePublish(params.publish),
            }
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Flint API key' },
    siteId: { type: 'string', description: 'ID of the Flint site to modify' },
    prompt: { type: 'string', description: 'Natural-language instructions for the agent' },
    templatePageSlug: {
      type: 'string',
      description: 'Slug of the template page to generate from',
    },
    items: {
      type: 'json',
      description: 'JSON array of 1-10 pages to generate, each with targetPageSlug and context',
    },
    taskId: { type: 'string', description: 'Task ID to look up' },
    publish: { type: 'boolean', description: 'Publish changes automatically on completion' },
    callbackUrl: { type: 'string', description: 'HTTPS webhook URL notified on completion' },
  },

  outputs: {
    taskId: { type: 'string', description: 'Identifier of the background task' },
    status: { type: 'string', description: 'Task status: running, completed, or failed' },
    createdAt: { type: 'string', description: 'When the task was created' },
    pagesCreated: {
      type: 'array',
      description: 'Pages created by the task [{slug, previewUrl, editUrl, publishedUrl}]',
    },
    pagesModified: {
      type: 'array',
      description: 'Pages modified by the task [{slug, previewUrl, editUrl, publishedUrl}]',
    },
    pagesDeleted: {
      type: 'array',
      description: 'Pages deleted by the task [{slug, previewUrl, editUrl, publishedUrl}]',
    },
    errorMessage: { type: 'string', description: 'Error message when the task failed' },
  },
}

export const FlintBlockMeta = {
  tags: ['automation', 'seo', 'agentic'],
  url: 'https://www.flint.com',
  templates: [
    {
      icon: FlintIcon,
      title: 'Flint programmatic SEO pages',
      prompt:
        'Build a workflow that reads a table of target keywords and customer data, then uses Flint to generate a landing page for each row from a template page, publishing them automatically.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'automation'],
    },
    {
      icon: FlintIcon,
      title: 'Flint case-study generator',
      prompt:
        'Create a workflow triggered when a deal is marked closed-won that pulls the customer details, drafts case-study context with an agent, and uses Flint to generate a case-study page from the template.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: FlintIcon,
      title: 'Flint site update from Slack',
      prompt:
        'Build a workflow triggered by a Slack message in the #website channel that turns the request into a Flint agent task prompt, starts the task, and replies in the thread with the task ID.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: FlintIcon,
      title: 'Flint task status monitor',
      prompt:
        'Create a scheduled workflow that reads pending Flint task IDs from a table, checks each task status with Flint, writes preview and published URLs back to the row when completed, and flags failures.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation', 'monitoring'],
    },
    {
      icon: FlintIcon,
      title: 'Flint changelog page publisher',
      prompt:
        'Build a workflow triggered when a new release is tagged in GitHub that summarizes the changes with an agent and starts a Flint task to add the release notes to the changelog page, publishing on completion.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: FlintIcon,
      title: 'Flint failed-task alerts',
      prompt:
        'Create a workflow that checks a Flint task status and, when the task has failed, posts the task ID and error message to a Slack channel so the team can rerun it.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'incident-management'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: FlintIcon,
      title: 'Flint location pages from a spreadsheet',
      prompt:
        'Build a workflow that reads city and service data from Google Sheets and uses Flint to generate a local landing page per city from a template, then writes each published URL back to the sheet.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'automation'],
      alsoIntegrations: ['google_sheets'],
    },
    {
      icon: FlintIcon,
      title: 'Flint content refresh agent',
      prompt:
        'Create a scheduled workflow that reviews outdated pages listed in a table, drafts updated copy instructions with an agent, and starts a Flint task per page to refresh the content without publishing until reviewed.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['seo', 'automation'],
    },
  ],
  skills: [
    {
      name: 'run-flint-site-update',
      description: 'Start a Flint agent task from a prompt and track it to completion.',
      content:
        '# Run a Flint Site Update\n\nModify a Flint site with a natural-language prompt.\n\n## Steps\n1. Choose the Create Task operation.\n2. Enter the Site ID and write a clear Prompt describing the change (for example "Add a new About page with a team section").\n3. Optionally enable Publish on Completion to push the change live automatically.\n4. Save the returned taskId, then poll with the Get Task operation until status is completed or failed.\n\n## Output\nReturn the task status and, when completed, the created/modified pages with their preview, edit, and published URLs.',
    },
    {
      name: 'generate-pages-from-template',
      description: 'Generate up to 10 Flint pages from a template page in one task.',
      content:
        '# Generate Pages from a Template\n\nCreate a batch of pages that share a template layout.\n\n## Steps\n1. Choose the Generate Pages operation.\n2. Enter the Site ID and the Template Page Slug of the existing template (for example /case-studies/template).\n3. Provide the Pages JSON array with 1-10 items, each containing targetPageSlug and context.\n4. Poll the task with Get Task until it completes.\n\n## Output\nReturn the list of created pages with their slugs and preview, edit, and published URLs.',
    },
    {
      name: 'check-flint-task-status',
      description: 'Check whether a Flint agent task is running, completed, or failed.',
      content:
        '# Check a Flint Task\n\nLook up the state and results of a background task.\n\n## Steps\n1. Choose the Get Task operation.\n2. Enter the Task ID returned when the task was created.\n3. Branch on the returned status: running means keep polling, completed exposes pagesCreated/pagesModified/pagesDeleted, failed exposes errorMessage.\n\n## Output\nReturn the task status plus page URLs on success or the error message on failure.',
    },
  ],
} as const satisfies BlockMeta
