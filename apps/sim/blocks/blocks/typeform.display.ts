import { TypeformIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const TypeformBlockDisplay = {
  type: 'typeform',
  name: 'Typeform',
  description: 'Interact with Typeform',
  category: 'tools',
  bgColor: '#262627',
  icon: TypeformIcon,
  longDescription:
    'Integrate Typeform into the workflow. Can retrieve responses, download files, and get form insights. Can be used in trigger mode to trigger a workflow when a form is submitted. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/typeform',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const TypeformBlockMeta = {
  tags: ['forms', 'data-analytics'],
  url: 'https://www.typeform.com',
  templates: [
    {
      icon: TypeformIcon,
      title: 'Survey response analyzer',
      prompt:
        'Create a workflow that pulls new Typeform responses daily, categorizes feedback by theme and sentiment, logs structured results to a table, and sends a Slack digest when a new batch of responses comes in with the key takeaways.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'support',
      tags: ['product', 'analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform NPS pipeline',
      prompt:
        'Build a workflow that collects Typeform NPS responses, classifies each as promoter/passive/detractor, writes the rolled-up score to a tracking table, and pings Slack on detractor spikes.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform lead enricher',
      prompt:
        'Create a workflow that watches Typeform lead-gen submissions, enriches each lead with company size and tech stack via Apollo, and pushes the enriched lead into Salesforce.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['apollo', 'salesforce'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform candidate screener',
      prompt:
        'Build a workflow that captures Typeform applicant responses, scores them against the role rubric with an agent, and creates a Greenhouse candidate with the score attached.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'analysis'],
      alsoIntegrations: ['greenhouse'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform event survey analyzer',
      prompt:
        'Create a workflow that processes Typeform event survey responses, summarizes feedback themes, writes structured insights to a feedback table, and emails the organizer the digest.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform onboarding follow-up',
      prompt:
        'Build a workflow that collects Typeform onboarding-flow responses, segments responders by job-to-be-done, and triggers tailored Loops email sequences for each segment.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: TypeformIcon,
      title: 'Typeform research analyzer',
      prompt:
        'Create a workflow that pulls Typeform research responses, clusters answers by theme, and writes a tables-based research insight log for the product team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'research'],
    },
  ],
  skills: [
    {
      name: 'retrieve-form-responses',
      description: 'Fetch Typeform responses for a form with date and completion filters.',
      content:
        '# Retrieve Typeform Responses\n\nPull submitted responses from a form so an agent can analyze or route them.\n\n## Steps\n1. Use the Retrieve Responses operation with the Form ID and your personal access token.\n2. Filter with Since and Until dates (natural language like "last week" works) to get only recent submissions.\n3. Set Completed to Only Completed to skip partial responses, and set Page Size for batch size.\n4. Use the Before and After cursor tokens to page through large result sets.\n\n## Output\nReturn the response items with their answers and metadata, plus the total count, ready for analysis or logging.',
    },
    {
      name: 'analyze-survey-responses',
      description: 'Pull form responses and categorize them by theme and sentiment for a digest.',
      content:
        '# Analyze Survey Responses\n\nTurn raw form submissions into structured insights.\n\n## Steps\n1. Use Retrieve Responses with the Form ID, narrowing by Since to the new batch.\n2. For each response, classify the free-text answers by theme and sentiment with an agent.\n3. Aggregate counts per theme and capture notable quotes.\n4. Optionally use Form Insights to pull completion and drop-off metrics for context.\n\n## Output\nReturn a structured summary of themes, sentiment breakdown, and standout responses suitable for a table row or a Slack digest.',
    },
    {
      name: 'create-form',
      description: 'Create a new Typeform form or quiz with fields and settings.',
      content:
        '# Create a Typeform Form\n\nSpin up a new form or quiz programmatically.\n\n## Steps\n1. Use the Create Form operation with your personal access token.\n2. Set the Form Title and choose the Form Type (form or quiz).\n3. Provide Fields as a JSON array of field objects (type, title, ref, validations) and optional Settings as JSON.\n4. Set a Workspace ID and Theme ID to place and style the form.\n\n## Output\nReturn the new form id and its links so you can share it or store the reference.',
    },
    {
      name: 'download-uploaded-file',
      description: 'Download a file a respondent uploaded through a Typeform file-upload field.',
      content:
        '# Download an Uploaded Typeform File\n\nRetrieve a file that a respondent attached in their submission.\n\n## Steps\n1. Use the Download File operation with the Form ID and your personal access token.\n2. Provide the Response ID (the response token), the file-upload Field ID, and the exact Filename.\n3. Use these IDs from a Retrieve Responses result that contains file-upload answers.\n\n## Output\nReturn the downloaded file and its content type so it can be stored, forwarded, or processed by a later step.',
    },
  ],
} as const satisfies BlockMeta
