import { GammaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GammaBlockDisplay = {
  type: 'gamma',
  name: 'Gamma',
  description: 'Generate presentations, documents, and webpages with AI',
  category: 'tools',
  bgColor: '#002253',
  icon: GammaIcon,
  longDescription:
    'Integrate Gamma into the workflow. Can generate presentations, documents, webpages, and social posts from text, create from templates, check generation status, and browse themes and folders.',
  docsLink: 'https://docs.sim.ai/integrations/gamma',
  integrationType: IntegrationType.Marketing,
} satisfies BlockDisplay

export const GammaBlockMeta = {
  tags: ['document-processing', 'content-management'],
  url: 'https://gamma.app',
  templates: [
    {
      icon: GammaIcon,
      title: 'Gamma deck from doc',
      prompt:
        'Build a workflow that takes a Google Docs source, generates a Gamma deck from the structure and bullet points, and emails the deck link to the author for polish.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['content', 'marketing'],
      alsoIntegrations: ['google_docs', 'gmail'],
    },
    {
      icon: GammaIcon,
      title: 'Gamma customer-story builder',
      prompt:
        'Create a workflow that takes a customer-story brief, generates a Gamma deck with the challenge, solution, results, and pull quote, and shares the link with the marketing team in Slack.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GammaIcon,
      title: 'Gamma weekly all-hands deck',
      prompt:
        'Build a scheduled weekly workflow that pulls KPIs from tables, generates a Gamma all-hands deck with the latest numbers, and posts the link to the leadership Slack channel.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GammaIcon,
      title: 'Gamma onboarding training',
      prompt:
        'Create a workflow that generates a Gamma onboarding training deck from a knowledge base topic, including interactive quizzes at the end, and shares it with the new hire.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'content'],
    },
    {
      icon: GammaIcon,
      title: 'Gamma sales pitch personalizer',
      prompt:
        'Build a workflow triggered by a Salesforce opportunity that generates a Gamma sales pitch deck personalized to the account, embeds the deck link in the opportunity, and notifies the rep.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'content'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: GammaIcon,
      title: 'Gamma weekly content carousel',
      prompt:
        'Create a scheduled workflow that turns the week’s top blog posts into a multi-slide Gamma carousel, then queues the export for X and LinkedIn posting.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
      alsoIntegrations: ['x', 'linkedin'],
    },
    {
      icon: GammaIcon,
      title: 'Gamma RFP responder',
      prompt:
        'Build a workflow that takes an inbound RFP, generates a Gamma response deck using a knowledge base of past proposals, and attaches the deck link to the linked HubSpot deal.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'content'],
      alsoIntegrations: ['hubspot'],
    },
  ],
  skills: [
    {
      name: 'generate-presentation',
      description: 'Generate a polished presentation deck from a topic or outline using Gamma.',
      content:
        '# Generate Presentation\n\nUse Gamma to turn a topic or outline into a finished presentation.\n\n## Steps\n1. Gather the source content: a topic, a brief, or a structured outline of the points to cover.\n2. Call Gamma to generate a presentation, choosing the number of cards and a theme that fits the audience.\n3. Request an export format (such as PDF or PPTX) if a downloadable file is needed.\n\n## Output\nReturn the link to the generated Gamma and, if requested, the export file URL. Summarize the deck structure (titles per card) so the requester can review before sharing.',
    },
    {
      name: 'generate-document',
      description: 'Generate a structured document or webpage from input text using Gamma.',
      content:
        '# Generate Document\n\nUse Gamma to produce a formatted document or webpage from raw input.\n\n## Steps\n1. Provide the input text and choose the output format (document or webpage).\n2. Call Gamma to generate the content, setting a theme and the desired length or number of cards.\n3. Capture the resulting Gamma URL and any export URL.\n\n## Output\nReturn the generated Gamma link plus a short outline of the sections it produced. Include the export file URL if one was requested.',
    },
    {
      name: 'personalize-deck-from-template',
      description:
        'Adapt an existing Gamma template into a prospect or client-specific deck with Generate from Template.',
      content:
        '# Personalize Deck From Template\n\nUse Gamma to scale on-brand, personalized decks from a proven template.\n\n## Steps\n1. Identify the template gamma ID to adapt (a master pitch or proposal deck) and collect the recipient details and the angle to tailor for.\n2. Use Generate from Template with that template gamma ID and a prompt that retargets the audience, swaps in the recipient name and use case, and adjusts emphasis (for example highlight compliance for a healthcare buyer). The template structure is preserved by default.\n3. Request an export (PDF or PPTX) if a downloadable file is needed.\n\n## Output\nReturn the generated Gamma link and any export URL. Note the recipient it was generated for so it can be attached to the right CRM record or email.',
    },
    {
      name: 'check-generation-status',
      description:
        'Poll a Gamma generation job by its generation ID and return the final deck link once ready.',
      content:
        '# Check Generation Status\n\nGamma generation is asynchronous, so use this to wait for a deck to finish.\n\n## Steps\n1. Take the generation ID returned when the deck was requested.\n2. Use Check Status to read the current status of the job.\n3. Repeat until the status is completed (or failed), respecting a sensible polling interval.\n\n## Output\nReturn the final status and, on success, the Gamma URL and any export URL. On failure, return the error details so the caller can retry or adjust the request.',
    },
  ],
} as const satisfies BlockMeta
