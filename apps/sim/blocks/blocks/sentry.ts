import { SentryIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { SentryResponse } from '@/tools/sentry/types'

export const SentryBlock: BlockConfig<SentryResponse> = {
  type: 'sentry',
  name: 'Sentry',
  description: 'Manage Sentry issues, projects, events, and releases',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Sentry into the workflow. Monitor issues, manage projects, track events, and coordinate releases across your applications.',
  docsLink: 'https://docs.sim.ai/tools/sentry',
  category: 'tools',
  bgColor: '#E0E0E0',
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
        { label: 'List Events', id: 'sentry_events_list' },
        { label: 'Get Event', id: 'sentry_events_get' },
        { label: 'List Releases', id: 'sentry_releases_list' },
        { label: 'Create Release', id: 'sentry_releases_create' },
        { label: 'Create Deploy', id: 'sentry_releases_deploy' },
      ],
      value: () => 'sentry_issues_list',
    },

    // =====================================================================
    // LIST ISSUES
    // =====================================================================
    {
      id: 'projectSlug',
      title: 'Project Slug',
      type: 'short-input',
      placeholder: 'Filter by project (optional)',
      condition: { field: 'operation', value: 'sentry_issues_list' },
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
- Common filters: is:unresolved, is:resolved, is:ignored, level:error, level:warning
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
      id: 'statsPeriod',
      title: 'Stats Period',
      type: 'short-input',
      placeholder: '24h, 7d, 30d',
      condition: { field: 'operation', value: 'sentry_issues_list' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'sentry_issues_list' },
    },
    {
      id: 'status',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Unresolved', id: 'unresolved' },
        { label: 'Resolved', id: 'resolved' },
        { label: 'Ignored', id: 'ignored' },
        { label: 'Muted', id: 'muted' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'sentry_issues_list' },
    },
    {
      id: 'sort',
      title: 'Sort By',
      type: 'dropdown',
      options: [
        { label: 'Date', id: 'date' },
        { label: 'New', id: 'new' },
        { label: 'Frequency', id: 'freq' },
        { label: 'Priority', id: 'priority' },
        { label: 'User Count', id: 'user' },
      ],
      value: () => 'date',
      condition: { field: 'operation', value: 'sentry_issues_list' },
    },

    // =====================================================================
    // GET ISSUE
    // =====================================================================
    {
      id: 'issueId',
      title: 'Issue ID',
      type: 'short-input',
      placeholder: 'Enter issue ID',
      condition: { field: 'operation', value: 'sentry_issues_get' },
      required: true,
    },

    // =====================================================================
    // UPDATE ISSUE
    // =====================================================================
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
      placeholder: 'User ID or email (empty to unassign)',
      condition: { field: 'operation', value: 'sentry_issues_update' },
    },
    {
      id: 'isBookmarked',
      title: 'Bookmark Issue',
      type: 'switch',
      condition: { field: 'operation', value: 'sentry_issues_update' },
    },
    {
      id: 'isSubscribed',
      title: 'Subscribe to Updates',
      type: 'switch',
      condition: { field: 'operation', value: 'sentry_issues_update' },
    },

    // =====================================================================
    // LIST PROJECTS
    // =====================================================================
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'sentry_projects_list' },
    },

    // =====================================================================
    // GET PROJECT
    // =====================================================================
    {
      id: 'projectSlug',
      title: 'Project ID or Slug',
      type: 'short-input',
      placeholder: 'Enter project ID or slug',
      condition: { field: 'operation', value: 'sentry_projects_get' },
      required: true,
    },

    // =====================================================================
    // CREATE PROJECT
    // =====================================================================
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
      id: 'slug',
      title: 'Project Slug',
      type: 'short-input',
      placeholder: 'Auto-generated if not provided',
      condition: { field: 'operation', value: 'sentry_projects_create' },
    },
    {
      id: 'platform',
      title: 'Platform',
      type: 'short-input',
      placeholder: 'javascript, python, node, etc.',
      condition: { field: 'operation', value: 'sentry_projects_create' },
    },
    {
      id: 'defaultRules',
      title: 'Create Default Alert Rules',
      type: 'switch',
      condition: { field: 'operation', value: 'sentry_projects_create' },
    },

    // =====================================================================
    // UPDATE PROJECT
    // =====================================================================
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
    },
    {
      id: 'platform',
      title: 'Platform',
      type: 'short-input',
      placeholder: 'Leave empty to keep current platform',
      condition: { field: 'operation', value: 'sentry_projects_update' },
    },
    {
      id: 'isBookmarked',
      title: 'Bookmark Project',
      type: 'switch',
      condition: { field: 'operation', value: 'sentry_projects_update' },
    },

    // =====================================================================
    // LIST EVENTS
    // =====================================================================
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
    },
    {
      id: 'statsPeriod',
      title: 'Stats Period',
      type: 'short-input',
      placeholder: '24h, 7d, 30d, 90d',
      condition: { field: 'operation', value: 'sentry_events_list' },
    },

    // =====================================================================
    // GET EVENT
    // =====================================================================
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

    // =====================================================================
    // LIST RELEASES
    // =====================================================================
    {
      id: 'projectSlug',
      title: 'Project Slug',
      type: 'short-input',
      placeholder: 'Filter by project (optional)',
      condition: { field: 'operation', value: 'sentry_releases_list' },
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
    },

    // =====================================================================
    // CREATE RELEASE
    // =====================================================================
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
    },
    {
      id: 'url',
      title: 'Release URL',
      type: 'long-input',
      placeholder: 'URL to release page (e.g., GitHub release)',
      condition: { field: 'operation', value: 'sentry_releases_create' },
    },
    {
      id: 'dateReleased',
      title: 'Release Date',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (defaults to now)',
      condition: { field: 'operation', value: 'sentry_releases_create' },
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

    // =====================================================================
    // CREATE DEPLOY
    // =====================================================================
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
    },
    {
      id: 'url',
      title: 'Deploy URL',
      type: 'long-input',
      placeholder: 'URL to CI/CD pipeline or deploy',
      condition: { field: 'operation', value: 'sentry_releases_deploy' },
    },
    {
      id: 'dateStarted',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp (defaults to now)',
      condition: { field: 'operation', value: 'sentry_releases_deploy' },
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

    // =====================================================================
    // COMMON PARAMETERS
    // =====================================================================
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
  ],
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
    ],
    config: {
      tool: (params) => {
        // Convert numeric fields
        if (params.limit) {
          params.limit = Number(params.limit)
        }

        // Return the appropriate tool based on operation
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
          default:
            return 'sentry_issues_list'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Sentry API authentication token' },
    organizationSlug: { type: 'string', description: 'Organization slug' },
    // Issue fields
    issueId: { type: 'string', description: 'Issue ID' },
    assignedTo: { type: 'string', description: 'User to assign issue to' },
    isBookmarked: { type: 'boolean', description: 'Bookmark state' },
    isSubscribed: { type: 'boolean', description: 'Subscription state' },
    // Project fields
    projectSlug: { type: 'string', description: 'Project slug' },
    name: { type: 'string', description: 'Project or deploy name' },
    teamSlug: { type: 'string', description: 'Team slug' },
    slug: { type: 'string', description: 'Project slug for creation/update' },
    platform: { type: 'string', description: 'Platform/language' },
    defaultRules: { type: 'boolean', description: 'Create default alert rules' },
    // Event fields
    eventId: { type: 'string', description: 'Event ID' },
    // Release fields
    version: { type: 'string', description: 'Release version' },
    projects: { type: 'string', description: 'Comma-separated project slugs' },
    ref: { type: 'string', description: 'Git reference' },
    url: { type: 'string', description: 'URL' },
    dateReleased: { type: 'string', description: 'Release date' },
    commits: { type: 'string', description: 'Commits JSON' },
    environment: { type: 'string', description: 'Environment name' },
    dateStarted: { type: 'string', description: 'Deploy start time' },
    dateFinished: { type: 'string', description: 'Deploy finish time' },
    // Common fields
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Result limit' },
    status: { type: 'string', description: 'Status filter' },
    sort: { type: 'string', description: 'Sort order' },
    statsPeriod: { type: 'string', description: 'Statistics time period' },
  },
  outputs: {
    // Issue outputs
    issues: { type: 'json', description: 'List of issues' },
    issue: { type: 'json', description: 'Single issue details' },
    // Project outputs
    projects: { type: 'json', description: 'List of projects' },
    project: { type: 'json', description: 'Single project details' },
    // Event outputs
    events: { type: 'json', description: 'List of events' },
    event: { type: 'json', description: 'Single event details' },
    // Release outputs
    releases: { type: 'json', description: 'List of releases' },
    release: { type: 'json', description: 'Single release details' },
    deploy: { type: 'json', description: 'Deploy details' },
    // Pagination
    nextCursor: { type: 'string', description: 'Pagination cursor' },
    hasMore: { type: 'boolean', description: 'More results available' },
  },
}
