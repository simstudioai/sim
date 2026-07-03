import { Bug } from '@sim/emcn/icons'
import { SentryIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { SentryResponse } from '@/tools/sentry/types'
import { getTrigger } from '@/triggers'

export const SentryBlock: BlockConfig<SentryResponse> = {
  type: 'sentry',
  name: 'Sentry',
  description: 'Manage Sentry issues, projects, events, and releases',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Sentry into the workflow. Monitor issues, manage projects, track events, and coordinate releases across your applications.',
  docsLink: 'https://docs.sim.ai/integrations/sentry',
  category: 'tools',
  integrationType: IntegrationType.Observability,
  bgColor: '#362D59',
  icon: SentryIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Issues', id: 'sentry_issues_list' },
        { label: 'Get Issue', id: 'sentry_issues_get' },
        { label: 'Update Issue', id: 'sentry_issues_update' },
        { label: 'List Projects', id: 'sentry_projects_list' },
        { label: 'Get Project', id: 'sentry_projects_get' },
        { label: 'Create Project', id: 'sentry_projects_create' },
        { label: 'Update Project', id: 'sentry_projects_update' },
        { label: 'List Teams', id: 'sentry_teams_list' },
        { label: 'List Events', id: 'sentry_events_list' },
        { label: 'Get Event', id: 'sentry_events_get' },
        { label: 'List Releases', id: 'sentry_releases_list' },
        { label: 'Create Release', id: 'sentry_releases_create' },
        { label: 'Create Deploy', id: 'sentry_releases_deploy' },
      ],
      value: () => 'sentry_issues_list',
    },

    {
      id: 'projectSlug',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Numeric project ID (optional)',
      condition: { field: 'operation', value: 'sentry_issues_list' },
      mode: 'advanced',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'e.g., is:unresolved, level:error',
      condition: { field: 'operation', value: 'sentry_issues_list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Sentry issue search query based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Use Sentry search syntax
- Common filters: is:unresolved, is:resolved, is:archived, level:error, level:warning
- Time-based: firstSeen:, lastSeen:, age:
- Assignment: assigned:, assigned_to_team:, bookmarks:
- Tags: tags[key]:value, browser:, os:, device:
- Events: event.type:, message:

### EXAMPLE
User: "Find unresolved high-priority errors from the last week"
Output: is:unresolved level:error age:-7d

Return ONLY the search query.`,
        placeholder: 'Describe what issues you want to find...',
      },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Unresolved', id: 'unresolved' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Archived', id: 'ignored' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sentry_issues_list' },
    },
    {
      id: 'statsPeriod',
      title: 'Stats Period',
      type: 'short-input',
      placeholder: '24h, 7d, 30d',
      condition: { field: 'operation', value: 'sentry_issues_list' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'sentry_issues_list' },
      mode: 'advanced',
    },
    {
      id: 'sort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Date', id: 'date' },
        { label: 'New', id: 'new' },
        { label: 'Trends', id: 'trends' },
        { label: 'Frequency', id: 'freq' },
        { label: 'User Count', id: 'user' },
      ],
      value: () => 'date',
      condition: { field: 'operation', value: 'sentry_issues_list' },
      mode: 'advanced',
    },

    {
      id: 'issueId',
      title: 'Issue ID',
      type: 'short-input',
      placeholder: 'Enter issue ID',
      condition: { field: 'operation', value: 'sentry_issues_get' },
      required: true,
    },

    {
      id: 'issueId',
      title: 'Issue ID',
      type: 'short-input',
      placeholder: 'Enter issue ID',
      condition: { field: 'operation', value: 'sentry_issues_update' },
      required: true,
    },
    {
      id: 'status',
      title: 'New Status',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Unresolved', id: 'unresolved' },
        { label: 'Ignored', id: 'ignored' },
        { label: 'Resolved in Next Release', id: 'resolvedInNextRelease' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sentry_issues_update' },
    },
    {
      id: 'assignedTo',
      title: 'Assign To',
      type: 'short-input',
      placeholder: 'user:<id>, team:<id>, or email (empty to unassign)',
      condition: { field: 'operation', value: 'sentry_issues_update' },
    },
    {
      id: 'isBookmarked',
      title: 'Bookmark Issue',
      type: 'switch',
      condition: { field: 'operation', value: 'sentry_issues_update' },
      mode: 'advanced',
    },
    {
      id: 'isSubscribed',
      title: 'Subscribe to Updates',
      type: 'switch',
      condition: { field: 'operation', value: 'sentry_issues_update' },
      mode: 'advanced',
    },

    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'sentry_projects_list' },
      mode: 'advanced',
    },

    {
      id: 'projectSlug',
      title: 'Project ID or Slug',
      type: 'short-input',
      placeholder: 'Enter project ID or slug',
      condition: { field: 'operation', value: 'sentry_projects_get' },
      required: true,
    },

    {
      id: 'name',
      title: 'Project Name',
      type: 'short-input',
      placeholder: 'Enter project name',
      condition: { field: 'operation', value: 'sentry_projects_create' },
      required: true,
    },
    {
      id: 'teamSlug',
      title: 'Team Slug',
      type: 'short-input',
      placeholder: 'Team that will own the project',
      condition: { field: 'operation', value: 'sentry_projects_create' },
      required: true,
    },
    {
      id: 'platform',
      title: 'Platform',
      type: 'short-input',
      placeholder: 'javascript, python, node, etc.',
      condition: { field: 'operation', value: 'sentry_projects_create' },
    },
    {
      id: 'slug',
      title: 'Project Slug',
      type: 'short-input',
      placeholder: 'Auto-generated if not provided',
      condition: { field: 'operation', value: 'sentry_projects_create' },
      mode: 'advanced',
    },
    {
      id: 'defaultRules',
      title: 'Create Default Alert Rules',
      type: 'switch',
      condition: { field: 'operation', value: 'sentry_projects_create' },
      mode: 'advanced',
    },

    {
      id: 'projectSlug',
      title: 'Project Slug',
      type: 'short-input',
      placeholder: 'Enter project slug',
      condition: { field: 'operation', value: 'sentry_projects_update' },
      required: true,
    },
    {
      id: 'name',
      title: 'New Name',
      type: 'short-input',
      placeholder: 'Leave empty to keep current name',
      condition: { field: 'operation', value: 'sentry_projects_update' },
    },
    {
      id: 'slug',
      title: 'New Slug',
      type: 'short-input',
      placeholder: 'Leave empty to keep current slug',
      condition: { field: 'operation', value: 'sentry_projects_update' },
      mode: 'advanced',
    },
    {
      id: 'platform',
      title: 'Platform',
      type: 'short-input',
      placeholder: 'Leave empty to keep current platform',
      condition: { field: 'operation', value: 'sentry_projects_update' },
      mode: 'advanced',
    },
    {
      id: 'isBookmarked',
      title: 'Bookmark Project',
      type: 'switch',
      condition: { field: 'operation', value: 'sentry_projects_update' },
      mode: 'advanced',
    },

    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Filter teams by name or slug (optional)',
      condition: { field: 'operation', value: 'sentry_teams_list' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'sentry_teams_list' },
      mode: 'advanced',
    },

    {
      id: 'projectSlug',
      title: 'Project Slug',
      type: 'short-input',
      placeholder: 'Enter project slug',
      condition: { field: 'operation', value: 'sentry_events_list' },
      required: true,
    },
    {
      id: 'issueId',
      title: 'Issue ID',
      type: 'short-input',
      placeholder: 'Filter by specific issue (optional)',
      condition: { field: 'operation', value: 'sentry_events_list' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'e.g., user.email:*@example.com',
      condition: { field: 'operation', value: 'sentry_events_list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Sentry events search query based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Use Sentry search syntax for events
- User filters: user.email:, user.id:, user.username:
- Context: browser:, os:, device:, url:, environment:
- Error details: error.type:, error.value:, message:
- Use wildcards (*) for partial matches

### EXAMPLE
User: "Find events from users at gmail in production"
Output: user.email:*@gmail.com environment:production

Return ONLY the search query.`,
        placeholder: 'Describe what events you want to find...',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: 'sentry_events_list' },
      mode: 'advanced',
    },
    {
      id: 'statsPeriod',
      title: 'Stats Period',
      type: 'short-input',
      placeholder: '24h, 7d, 30d, 90d',
      condition: { field: 'operation', value: 'sentry_events_list' },
      mode: 'advanced',
    },

    {
      id: 'projectSlug',
      title: 'Project Slug',
      type: 'short-input',
      placeholder: 'Enter project slug',
      condition: { field: 'operation', value: 'sentry_events_get' },
      required: true,
    },
    {
      id: 'eventId',
      title: 'Event ID',
      type: 'short-input',
      placeholder: 'Enter event ID',
      condition: { field: 'operation', value: 'sentry_events_get' },
      required: true,
    },

    {
      id: 'projectSlug',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Numeric project ID (optional)',
      condition: { field: 'operation', value: 'sentry_releases_list' },
      mode: 'advanced',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Search for specific release versions',
      condition: { field: 'operation', value: 'sentry_releases_list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Sentry releases search query based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Search by version string or partial match
- Can include version numbers, package names, commit SHAs
- Use wildcards for partial matches if needed

### EXAMPLE
User: "Find all releases from version 2.x"
Output: 2.*

Return ONLY the search query.`,
        placeholder: 'Describe which releases you want to find...',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'sentry_releases_list' },
      mode: 'advanced',
    },

    {
      id: 'version',
      title: 'Version',
      type: 'short-input',
      placeholder: 'e.g., 2.0.0 or my-app@1.0.0',
      condition: { field: 'operation', value: 'sentry_releases_create' },
      required: true,
    },
    {
      id: 'projects',
      title: 'Projects',
      type: 'long-input',
      placeholder: 'Comma-separated project slugs',
      condition: { field: 'operation', value: 'sentry_releases_create' },
      required: true,
    },
    {
      id: 'ref',
      title: 'Git Reference',
      type: 'short-input',
      placeholder: 'Commit SHA, tag, or branch',
      condition: { field: 'operation', value: 'sentry_releases_create' },
      mode: 'advanced',
    },
    {
      id: 'url',
      title: 'Release URL',
      type: 'long-input',
      placeholder: 'URL to release page (e.g., GitHub release)',
      condition: { field: 'operation', value: 'sentry_releases_create' },
      mode: 'advanced',
    },
    {
      id: 'dateReleased',
      title: 'Release Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (defaults to now)',
      condition: { field: 'operation', value: 'sentry_releases_create' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "yesterday" -> Calculate yesterday's date at 00:00:00Z
- "last week" -> Calculate 7 days ago at 00:00:00Z
- "now" -> Current date and time in UTC
- "beginning of this month" -> First day of current month at 00:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the date (e.g., "now", "yesterday", "last Friday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'commits',
      title: 'Commits (JSON)',
      type: 'long-input',
      placeholder: '[{"id":"abc123","message":"Fix bug"}]',
      condition: { field: 'operation', value: 'sentry_releases_create' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of commits for a Sentry release based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON array starting with [ and ending with ]
- Each commit must have: id (commit SHA)
- Optional fields: message, author_name, author_email, timestamp
- Include meaningful commit messages

### EXAMPLE
User: "3 commits for bug fixes and a feature addition"
Output:
[
  {"id": "abc123def", "message": "Fix authentication timeout issue"},
  {"id": "def456ghi", "message": "Fix memory leak in data processor"},
  {"id": "ghi789jkl", "message": "Add user dashboard analytics feature"}
]

Return ONLY the JSON array.`,
        placeholder: 'Describe the commits for this release...',
        generationType: 'json-object',
      },
    },

    {
      id: 'version',
      title: 'Version',
      type: 'short-input',
      placeholder: 'Release version to deploy',
      condition: { field: 'operation', value: 'sentry_releases_deploy' },
      required: true,
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'short-input',
      placeholder: 'production, staging, etc.',
      condition: { field: 'operation', value: 'sentry_releases_deploy' },
      required: true,
    },
    {
      id: 'name',
      title: 'Deploy Name',
      type: 'short-input',
      placeholder: 'Optional deploy name',
      condition: { field: 'operation', value: 'sentry_releases_deploy' },
      mode: 'advanced',
    },
    {
      id: 'url',
      title: 'Deploy URL',
      type: 'long-input',
      placeholder: 'URL to CI/CD pipeline or deploy',
      condition: { field: 'operation', value: 'sentry_releases_deploy' },
      mode: 'advanced',
    },
    {
      id: 'dateStarted',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (defaults to now)',
      condition: { field: 'operation', value: 'sentry_releases_deploy' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "now" -> Current date and time in UTC
- "5 minutes ago" -> Calculate 5 minutes before current time
- "start of deploy" -> Current date and time in UTC
- "yesterday at 3pm" -> Yesterday at 15:00:00Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when the deploy started (e.g., "now", "5 minutes ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'dateFinished',
      title: 'Finish Time',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp',
      condition: { field: 'operation', value: 'sentry_releases_deploy' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp based on the user's description.
The timestamp should be in the format: YYYY-MM-DDTHH:MM:SSZ (UTC timezone).
Examples:
- "now" -> Current date and time in UTC
- "in 10 minutes" -> Calculate 10 minutes after current time
- "when deploy completes" -> Current date and time in UTC
- "end of day" -> Current date at 23:59:59Z

Return ONLY the timestamp string - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when the deploy finished (e.g., "now", "in 10 minutes")...',
        generationType: 'timestamp',
      },
    },

    {
      id: 'cursor',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'Cursor from a previous response (nextCursor)',
      condition: {
        field: 'operation',
        value: [
          'sentry_issues_list',
          'sentry_projects_list',
          'sentry_events_list',
          'sentry_releases_list',
          'sentry_teams_list',
        ],
      },
      mode: 'advanced',
    },

    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Sentry API token',
      password: true,
      required: true,
    },
    {
      id: 'organizationSlug',
      title: 'Organization Slug',
      type: 'short-input',
      placeholder: 'Your Sentry organization slug',
      required: true,
    },

    ...getTrigger('sentry_issue_created').subBlocks,
    ...getTrigger('sentry_issue_resolved').subBlocks,
    ...getTrigger('sentry_error_created').subBlocks,
    ...getTrigger('sentry_issue_alert').subBlocks,
    ...getTrigger('sentry_metric_alert').subBlocks,
  ],
  triggers: {
    enabled: true,
    available: [
      'sentry_issue_created',
      'sentry_issue_resolved',
      'sentry_error_created',
      'sentry_issue_alert',
      'sentry_metric_alert',
    ],
  },
  tools: {
    access: [
      'sentry_issues_list',
      'sentry_issues_get',
      'sentry_issues_update',
      'sentry_projects_list',
      'sentry_projects_get',
      'sentry_projects_create',
      'sentry_projects_update',
      'sentry_events_list',
      'sentry_events_get',
      'sentry_releases_list',
      'sentry_releases_create',
      'sentry_releases_deploy',
      'sentry_teams_list',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'sentry_issues_list':
            return 'sentry_issues_list'
          case 'sentry_issues_get':
            return 'sentry_issues_get'
          case 'sentry_issues_update':
            return 'sentry_issues_update'
          case 'sentry_projects_list':
            return 'sentry_projects_list'
          case 'sentry_projects_get':
            return 'sentry_projects_get'
          case 'sentry_projects_create':
            return 'sentry_projects_create'
          case 'sentry_projects_update':
            return 'sentry_projects_update'
          case 'sentry_events_list':
            return 'sentry_events_list'
          case 'sentry_events_get':
            return 'sentry_events_get'
          case 'sentry_releases_list':
            return 'sentry_releases_list'
          case 'sentry_releases_create':
            return 'sentry_releases_create'
          case 'sentry_releases_deploy':
            return 'sentry_releases_deploy'
          case 'sentry_teams_list':
            return 'sentry_teams_list'
          default:
            return 'sentry_issues_list'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.limit) result.limit = Number(params.limit)
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Sentry API authentication token' },
    organizationSlug: { type: 'string', description: 'Organization slug' },
    issueId: { type: 'string', description: 'Issue ID' },
    assignedTo: { type: 'string', description: 'User to assign issue to' },
    isBookmarked: { type: 'boolean', description: 'Bookmark state' },
    isSubscribed: { type: 'boolean', description: 'Subscription state' },
    projectSlug: { type: 'string', description: 'Project slug' },
    name: { type: 'string', description: 'Project or deploy name' },
    teamSlug: { type: 'string', description: 'Team slug' },
    slug: { type: 'string', description: 'Project slug for creation/update' },
    platform: { type: 'string', description: 'Platform/language' },
    defaultRules: { type: 'boolean', description: 'Create default alert rules' },
    eventId: { type: 'string', description: 'Event ID' },
    version: { type: 'string', description: 'Release version' },
    projects: { type: 'string', description: 'Comma-separated project slugs' },
    ref: { type: 'string', description: 'Git reference' },
    url: { type: 'string', description: 'URL' },
    dateReleased: { type: 'string', description: 'Release date' },
    commits: { type: 'string', description: 'Commits JSON' },
    environment: { type: 'string', description: 'Environment name' },
    dateStarted: { type: 'string', description: 'Deploy start time' },
    dateFinished: { type: 'string', description: 'Deploy finish time' },
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Result limit' },
    status: { type: 'string', description: 'Status filter' },
    sort: { type: 'string', description: 'Sort order' },
    statsPeriod: { type: 'string', description: 'Statistics time period' },
    cursor: { type: 'string', description: 'Pagination cursor' },
  },
  outputs: {
    issues: { type: 'json', description: 'List of issues' },
    issue: { type: 'json', description: 'Single issue details' },
    projects: { type: 'json', description: 'List of projects' },
    project: { type: 'json', description: 'Single project details' },
    teams: {
      type: 'json',
      description: 'List of teams (id, slug, name, memberCount, projects)',
    },
    events: { type: 'json', description: 'List of events' },
    event: { type: 'json', description: 'Single event details' },
    releases: { type: 'json', description: 'List of releases' },
    release: { type: 'json', description: 'Single release details' },
    deploy: { type: 'json', description: 'Deploy details' },
    nextCursor: { type: 'string', description: 'Pagination cursor' },
    hasMore: { type: 'boolean', description: 'More results available' },
  },
}

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
