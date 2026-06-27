import { Bug } from '@/components/emcn/icons'
import { SentryIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const SentryBlockDisplay = {
  type: 'sentry',
  name: 'Sentry',
  description: 'Manage Sentry issues, projects, events, and releases',
  category: 'tools',
  bgColor: '#362D59',
  icon: SentryIcon,
  longDescription:
    'Integrate Sentry into the workflow. Monitor issues, manage projects, track events, and coordinate releases across your applications.',
  docsLink: 'https://docs.sim.ai/integrations/sentry',
  integrationType: IntegrationType.Observability,
} satisfies BlockDisplay

export const SentryBlockMeta = {
  tags: ['error-tracking', 'monitoring'],
  url: 'https://sentry.io',
  templates: [
    {
      icon: Bug,
      title: 'Bug triage agent',
      prompt:
        'Build an agent that monitors Sentry for new errors, automatically triages them by severity and affected users, creates Linear tickets for critical issues with full stack traces, and sends a Slack notification to the on-call channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'automation'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: SentryIcon,
      title: 'Sentry error triage',
      prompt:
        'Build a scheduled workflow that polls Sentry for new unresolved issues, classifies severity, groups similar issues, creates a Linear ticket on first occurrence above the threshold, and pings the owning team in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: SentryIcon,
      title: 'Sentry release health gate',
      prompt:
        'Create a workflow that runs after a Vercel deploy, checks Sentry release health, and rolls back the deploy if the error rate exceeds the threshold, posting an alert to Slack.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['vercel', 'slack'],
    },
    {
      icon: SentryIcon,
      title: 'Sentry weekly regression brief',
      prompt:
        'Build a scheduled weekly workflow that compares Sentry error rates week-over-week, identifies top regressors, and writes a brief to engineering leadership in Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SentryIcon,
      title: 'Sentry source-map verifier',
      prompt:
        'Create a scheduled workflow that scans Sentry for issues with missing or stale source maps, writes a tracking table, and opens Linear tickets for the worst offenders.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: SentryIcon,
      title: 'Sentry customer-impact mapper',
      prompt:
        'Build a workflow that takes a Sentry issue and matches affected users to CRM accounts, scoring customer impact, and creates a customer-facing incident note in HubSpot for the worst-affected accounts.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'sales'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: SentryIcon,
      title: 'Sentry release tracker on deploy',
      prompt:
        'Create a workflow that watches GitHub for merges to main, creates a new Sentry release with the commit range, marks the deploy in Sentry for the production environment, and posts the release notes and linked issues to Slack so the team knows what shipped.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'automation'],
      alsoIntegrations: ['github', 'slack'],
    },
  ],
  skills: [
    {
      name: 'triage-unresolved-errors',
      description:
        'List unresolved Sentry issues, rank them by impact, and summarize the most urgent errors to fix.',
      content:
        '# Triage Unresolved Errors\n\nProduce a prioritized view of the Sentry errors that most need attention.\n\n## Steps\n1. Run List Issues with the query is:unresolved, sorting by frequency or user count and setting a stats period such as 24h or 7d.\n2. For the top issues, run Get Issue to pull the title, culprit, event count, and number of affected users.\n3. Rank by a blend of event volume, affected users, and recency.\n\n## Output\nReturn a ranked list of issues with their ID, title, event count, affected users, and a one-line recommendation for each. Link each issue so an engineer can open it directly.',
    },
    {
      name: 'resolve-or-assign-issue',
      description:
        'Update a Sentry issue to change status, assign an owner, or bookmark it for follow-up.',
      content:
        '# Resolve or Assign Issue\n\nAct on a specific Sentry issue once a decision has been made.\n\n## Steps\n1. Identify the issue ID (from a triage step or a notification).\n2. Run Update Issue, setting the new status (resolved, ignored, or resolved in next release) as appropriate.\n3. To route ownership, set Assign To with a user ID or email. Bookmark or subscribe if the team wants to track it.\n\n## Output\nConfirm the issue ID, its new status, and the assignee, so the change is auditable.',
    },
    {
      name: 'investigate-issue-events',
      description:
        'Pull the events behind a Sentry issue to inspect impacted users, environments, and context.',
      content:
        '# Investigate Issue Events\n\nDrill into the raw events for an issue to understand who and what is affected.\n\n## Steps\n1. Run List Events for the project, optionally filtering by an issue ID and an events search query (for example user.email or environment filters).\n2. Run Get Event on a representative event ID to retrieve the full payload: tags, breadcrumbs, request context, and stack trace.\n3. Group findings by environment, release, browser, or OS.\n\n## Output\nSummarize the affected environments and users, the common context across events, and the likely trigger, citing the specific event IDs examined.',
    },
    {
      name: 'track-release-and-deploy',
      description:
        'Create a Sentry release for a version and mark a deploy to an environment for regression tracking.',
      content:
        '# Track Release and Deploy\n\nRegister a new version in Sentry so errors can be attributed to the release that introduced them.\n\n## Steps\n1. Run Create Release with the version string and the comma-separated project slugs. Add the git ref, release URL, and commits JSON if available so Sentry can associate suspect commits.\n2. Run Create Deploy with the same version and the target environment (for example production), including start and finish times.\n3. Optionally run List Releases afterward to confirm the version is registered.\n\n## Output\nReport the created release version, the deploy environment, and confirm both were recorded for regression monitoring.',
    },
  ],
} as const satisfies BlockMeta
