import { PosthogIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const PostHogBlockDisplay = {
  type: 'posthog',
  name: 'PostHog',
  description: 'Product analytics and feature management',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: PosthogIcon,
  longDescription:
    'Integrate PostHog into your workflow. Track events, manage feature flags, analyze user behavior, run experiments, create surveys, and access session recordings.',
  docsLink: 'https://docs.sim.ai/integrations/posthog',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

export const PostHogBlockMeta = {
  tags: ['data-analytics', 'monitoring', 'feature-flags'],
  url: 'https://posthog.com',
  templates: [
    {
      icon: PosthogIcon,
      title: 'PostHog insight digest',
      prompt:
        'Create a scheduled daily workflow that pulls key PostHog insights — DAU, top events, funnels — and posts a digest to Slack with week-over-week deltas and emoji indicators.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PosthogIcon,
      title: 'PostHog feature flag flip notifier',
      prompt:
        'Build a scheduled workflow that polls PostHog feature flags, detects status changes since the last run, and posts a Slack notification with the old and new state for each changed flag.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PosthogIcon,
      title: 'PostHog session replay triage',
      prompt:
        'Create a scheduled workflow that lists PostHog session recordings with rage clicks or dead clicks, scores each for severity, and creates a Linear ticket for the worst sessions.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['product', 'engineering'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: PosthogIcon,
      title: 'PostHog event taxonomy enforcer',
      prompt:
        'Build a workflow that scans PostHog events daily, flags any new event names that violate the naming convention, and opens a Linear ticket for the engineer to clean up tracking debt.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: PosthogIcon,
      title: 'PostHog cohort enrichment',
      prompt:
        'Create a workflow that pulls a PostHog cohort, enriches each user with HubSpot lifecycle stage and Stripe LTV, and writes the enriched cohort to a tables-based targeting view.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['product', 'crm', 'sync'],
      alsoIntegrations: ['hubspot', 'stripe'],
    },
    {
      icon: PosthogIcon,
      title: 'PostHog + Profound user-journey enricher',
      prompt:
        'Build a scheduled weekly workflow that joins PostHog user journeys with Profound AI brand signal to identify how AI-driven discovery converts, and writes a report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'analysis'],
      alsoIntegrations: ['profound'],
    },
    {
      icon: PosthogIcon,
      title: 'PostHog survey response analyzer',
      prompt:
        'Create a scheduled workflow that lists active PostHog surveys, pulls their responses with a query, runs sentiment and theme analysis across the open-text answers, and posts a summary of top themes and NPS movement to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'capture-event',
      description: 'Send a product analytics event to PostHog for a user with custom properties.',
      content:
        '# Capture Event\n\nRecord a user action in PostHog.\n\n## Steps\n1. Use the Capture Event operation with the Project API Key and Project ID.\n2. Set the Event Name (for example purchase_completed) and the Distinct ID identifying the user.\n3. Add Properties as a JSON object with relevant context such as plan, price, or page, and optionally a Timestamp.\n4. For many events at once, use Batch Events with a JSON array instead.\n\n## Output\nConfirm the event name and user it was captured for, and report success or any validation error returned.',
    },
    {
      name: 'query-product-data',
      description: 'Run a HogQL query against PostHog to answer a product analytics question.',
      content:
        '# Query Product Data\n\nPull custom analytics with HogQL.\n\n## Steps\n1. Use the Run Query operation with your Personal API Key, Project ID, and Region.\n2. Write the HogQL Query (SQL-like) to compute the metric, for example daily active users or top events over a window.\n3. Pass Query Values for any parameters.\n4. Aggregate or format the returned rows for the answer.\n\n## Output\nThe query result rows summarized into a direct answer, noting the time window and any assumptions in the query.',
    },
    {
      name: 'manage-feature-flag',
      description: 'Create, update, or toggle a PostHog feature flag and control its rollout.',
      content:
        '# Manage Feature Flag\n\nControl a feature rollout in PostHog.\n\n## Steps\n1. Use Create Feature Flag with a Flag Key, Name, and a Rollout Percentage, or Update Feature Flag by Feature Flag ID to change state.\n2. Set Active on or off and supply Filters as JSON to target specific cohorts or person properties.\n3. Provide the Personal API Key, Project ID, and Region.\n4. Use List Feature Flags to confirm the current state.\n\n## Output\nReport the flag key, whether it is active, and the rollout percentage or targeting now in effect.',
    },
    {
      name: 'analyze-survey-responses',
      description: 'List PostHog surveys and pull responses to summarize themes and satisfaction.',
      content:
        '# Analyze Survey Responses\n\nTurn survey feedback into insight.\n\n## Steps\n1. Use List Surveys to find the active survey, then Get Survey for its definition.\n2. Use Run Query (HogQL) to pull the survey response events for that survey over a date window.\n3. Group open-text answers by theme and compute the rating or NPS distribution.\n\n## Output\nA short summary of the top themes from open responses plus the rating or NPS breakdown and any notable movement.',
    },
    {
      name: 'add-release-annotation',
      description:
        'Create a PostHog annotation marking a deploy or release on the analytics timeline.',
      content:
        '# Add Release Annotation\n\nMark an event on the PostHog timeline for context.\n\n## Steps\n1. Use the Create Annotation operation with the Personal API Key, Project ID, and Region.\n2. Provide the Content describing what happened (for example a deploy or campaign launch) and a Date Marker timestamp.\n3. Set the Scope to project or dashboard item.\n\n## Output\nConfirm the annotation content and the date it was placed on so charts show the marker.',
    },
  ],
} as const satisfies BlockMeta
