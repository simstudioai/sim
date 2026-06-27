import { GoogleFormsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GoogleFormsBlockDisplay = {
  type: 'google_forms',
  name: 'Google Forms',
  description: 'Manage Google Forms and responses',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleFormsIcon,
  longDescription:
    'Integrate Google Forms into your workflow. Read form structure, get responses, create forms, update content, and manage notification watches.',
  docsLink: 'https://docs.sim.ai/integrations/google_forms',
  integrationType: IntegrationType.Documents,
} satisfies BlockDisplay

export const GoogleFormsBlockMeta = {
  tags: ['google-workspace', 'forms', 'data-analytics'],
  url: 'https://workspace.google.com/products/forms',
  templates: [
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms to CRM',
      prompt:
        'Build a workflow that watches Google Forms responses, enriches each submitter with company data, and pushes qualified leads into HubSpot with the right owner and source.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms support intake',
      prompt:
        'Create a workflow that turns Google Forms support submissions into Zendesk tickets, prioritizes them with an agent, and posts the new ticket to the support Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
      alsoIntegrations: ['zendesk', 'slack'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms event RSVP tracker',
      prompt:
        'Build a workflow that captures Google Forms event RSVPs into a table, sends confirmation emails, and provides a daily attendee dashboard to the organizer.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms survey analyzer',
      prompt:
        'Create a workflow that processes Google Forms survey responses, classifies sentiment and themes with an agent, and writes a weekly insight digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms approvals router',
      prompt:
        'Build a workflow that turns Google Forms approval requests into Slack messages with quick-action buttons, captures the decision, and emails the requester the outcome.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['team', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms PTO collector',
      prompt:
        'Create a workflow that processes PTO requests from Google Forms, captures manager approval over Slack, and updates the HR table with approved time off.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleFormsIcon,
      title: 'Google Forms quiz grader',
      prompt:
        'Build a workflow that captures Google Forms quiz responses, scores each automatically with an agent, writes scores to a tables-based gradebook, and emails the student.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'analysis'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'collect-form-responses',
      description: 'Retrieve and structure responses from a Google Form for analysis or routing.',
      content:
        '# Collect Form Responses\n\nPull submissions from a Google Form.\n\n## Steps\n1. Select the form (or pass its form ID).\n2. Run the Get Responses operation; set Page Size to cover the expected volume. Leave Response ID empty to fetch all, or set it to fetch one specific submission.\n3. To map answers to questions, run Get Form once and use the item titles to label each answer.\n4. Normalize each response into clean rows keyed by question.\n\n## Output\nA structured list of responses with respondent answers labeled by question. Include the total count and the time range covered.',
    },
    {
      name: 'analyze-survey-results',
      description:
        'Read Google Form responses and summarize trends, sentiment, and notable findings.',
      content:
        '# Analyze Survey Results\n\nTurn raw form responses into insight.\n\n## Steps\n1. Run Get Form to learn the questions and their types (choice, scale, text).\n2. Run Get Responses to pull all submissions.\n3. For choice/scale questions, compute distributions and averages. For free-text, cluster into themes and gauge sentiment.\n4. Surface the strongest signals and any outliers or recurring complaints.\n\n## Output\nA digest: response count, per-question breakdown (top choices, averages), 3-5 key themes from free text, and notable verbatim quotes. Keep numbers accurate to the data.',
    },
    {
      name: 'create-form',
      description: 'Create a new Google Form and add questions via batch update.',
      content:
        '# Create a Form\n\nBuild a new Google Form with questions.\n\n## Steps\n1. Run Create Form with the form title (and optional document title). Capture the returned form ID.\n2. Build a Batch Update requests array to add questions. Use `createItem` with `choiceQuestion` (RADIO/CHECKBOX/DROP_DOWN), `textQuestion`, or `scaleQuestion`, each at a `location.index`.\n3. Run Batch Update on the form ID with that requests array.\n4. If the form should accept submissions, run Set Publish Settings with Published on.\n\n## Output\nConfirm the form was created, list the questions added, and return the responder URL and form ID.',
    },
  ],
} as const satisfies BlockMeta
