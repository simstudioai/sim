import { AmplitudeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AmplitudeBlockDisplay = {
  type: 'amplitude',
  name: 'Amplitude',
  description: 'Track events and query analytics from Amplitude',
  category: 'tools',
  bgColor: '#1B1F3B',
  icon: AmplitudeIcon,
  iconColor: '#1F77E0',
  longDescription:
    'Integrate Amplitude into your workflow to track events, identify users and groups, search for users, query analytics, and retrieve revenue data.',
  docsLink: 'https://docs.sim.ai/integrations/amplitude',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay

export const AmplitudeBlockMeta = {
  tags: ['data-analytics', 'marketing'],
  url: 'https://amplitude.com',
  templates: [
    {
      icon: AmplitudeIcon,
      title: 'Product analytics digest',
      prompt:
        'Create a scheduled weekly workflow that pulls key product metrics from Amplitude — active users, event segmentation for top events, and revenue — generates an executive summary with week-over-week trends, and posts it to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'reporting', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude event regression watcher',
      prompt:
        'Build a scheduled workflow that runs event segmentation on key Amplitude events every morning, compares the counts against the trailing 14-day baseline, and posts a Slack alert when any event drops more than a configurable threshold.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude active-user tracker',
      prompt:
        'Create a scheduled workflow that pulls daily and monthly active users from Amplitude, writes the values into a tracking table, and feeds the trend to downstream marketing automations.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'sync'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude revenue digest',
      prompt:
        'Build a scheduled weekly workflow that pulls Amplitude revenue data, breaks it down by week-over-week change, and posts a digest to the product Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude + PostHog cross-tool dashboard',
      prompt:
        'Build a scheduled workflow that aggregates equivalent active-user and event metrics from both Amplitude and PostHog, writes a side-by-side comparison to a table, and surfaces discrepancies to the product team in Slack.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis', 'reporting'],
      alsoIntegrations: ['posthog', 'slack'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude + Fathom unified analytics',
      prompt:
        'Build a scheduled workflow that joins Amplitude product analytics with Fathom web analytics, writes a unified active-user and engagement report, and surfaces anomalies.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['fathom'],
    },
    {
      icon: AmplitudeIcon,
      title: 'Amplitude + Hex deep-dive notebook',
      prompt:
        'Create a workflow that triggers a Hex deep-dive notebook when an Amplitude metric crosses an anomaly threshold, runs analysis, and posts the notebook output to Slack.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['hex', 'slack'],
    },
  ],
  skills: [
    {
      name: 'track-product-event',
      description:
        'Send a behavioral event to Amplitude with user and event properties for analytics.',
      content:
        '# Track Product Event\n\nLog a user action to Amplitude so it shows up in analytics.\n\n## Steps\n1. Determine the event name and the user identifier (user ID or device ID).\n2. Attach relevant event properties (plan, source, value) and user properties.\n3. Send the event to Amplitude.\n\n## Output\nConfirm the event was sent with its name and the user it was attributed to. Note any required field that was missing.',
    },
    {
      name: 'segment-event-counts',
      description:
        'Run Amplitude event segmentation over a date range and report unique and total counts, optionally grouped by a property.',
      content:
        '# Segment Event Counts\n\nMeasure how often an event fires in Amplitude over a time window.\n\n## Steps\n1. Identify the event type and the start and end dates (YYYYMMDD) to analyze.\n2. Pick the measurement (uniques, totals, or average) and the interval (daily, weekly, monthly).\n3. Optionally group by a user or event property to break the counts down by segment.\n4. Run the event segmentation query and read the resulting time series.\n\n## Output\nThe series of counts per interval, the segment breakdown if grouped, and a callout of the largest movement versus the start of the range.',
    },
    {
      name: 'summarize-engagement-metrics',
      description:
        'Pull Amplitude active users, top events, and revenue and summarize product engagement for a period.',
      content:
        '# Summarize Engagement Metrics\n\nProduce a short product engagement summary from Amplitude data.\n\n## Steps\n1. Query active and new users for the target period.\n2. Pull the most-triggered events with event segmentation to see what users do most.\n3. Pull revenue metrics for the same period.\n4. Compare each against the prior period to spot trends.\n\n## Output\nA concise summary: active users, top events, revenue, and notable trends versus the prior period.',
    },
    {
      name: 'lookup-user-activity',
      description:
        'Find a user in Amplitude by ID and pull their recent event activity and profile properties.',
      content:
        '# Lookup User Activity\n\nInvestigate a single user in Amplitude for support or debugging.\n\n## Steps\n1. Search for the user by user ID, device ID, or Amplitude ID to resolve their Amplitude ID.\n2. Pull the user activity stream for that Amplitude ID, ordered latest first.\n3. Optionally fetch the user profile to see their current properties.\n\n## Output\nA timeline of the user recent events plus key profile properties. Note the time range covered.',
    },
  ],
} as const satisfies BlockMeta
