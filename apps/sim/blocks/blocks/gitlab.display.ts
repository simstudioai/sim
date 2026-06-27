import { GitLabIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GitLabBlockDisplay = {
  type: 'gitlab',
  name: 'GitLab',
  description: 'Interact with GitLab projects, issues, merge requests, and pipelines',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GitLabIcon,
  longDescription:
    'Integrate GitLab into the workflow. Can manage projects, issues, merge requests, pipelines, and add comments. Supports all core GitLab DevOps operations.',
  docsLink: 'https://docs.sim.ai/integrations/gitlab',
  integrationType: IntegrationType.DevOps,
  triggerAllowed: true,
} satisfies BlockDisplay

export const GitLabBlockMeta = {
  tags: ['version-control', 'ci-cd'],
  url: 'https://about.gitlab.com',
  templates: [
    {
      icon: GitLabIcon,
      title: 'GitLab merge request reviewer',
      prompt:
        'Create a knowledge base from my coding standards and architecture docs. Build a scheduled workflow that lists open GitLab merge requests, fetches each diff, runs an agent that checks the code against the knowledge base and flags security issues, performance concerns, and style violations, then posts a structured review as an MR comment.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'automation'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab pipeline failure responder',
      prompt:
        'Build a scheduled workflow that lists recent GitLab pipelines on the main branch, finds newly failed runs, summarizes the root cause from the job logs, identifies the most likely owner from recent commits, opens a GitLab issue with the diagnosis, and posts an alert to Slack with a link to the failing pipeline.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab issue triager',
      prompt:
        'Create a scheduled workflow that runs every hour, pulls new GitLab issues, classifies each by component, severity, and effort, applies labels and assigns the right owner, and posts a daily Slack digest of unassigned and stale issues so nothing slips through.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab release publisher',
      prompt:
        'Build a scheduled workflow that detects new GitLab release tags, gathers merged merge requests since the previous tag, groups changes by component, drafts release notes as a file, and posts the formatted summary back as a comment on the release.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'content'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab project health digest',
      prompt:
        'Create a scheduled weekly workflow that pulls open issues, stale merge requests, recent pipeline failures, and contributor activity for every GitLab project, logs metrics to a tracking table, and sends a Slack health digest to engineering leadership.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab merge request unblocker',
      prompt:
        'Build a scheduled daily workflow that lists open GitLab merge requests, identifies those blocked on review for more than two days, sends targeted Slack DMs to the assigned reviewers with the MR link, and updates a table tracking unblock actions.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'team'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GitLabIcon,
      title: 'GitLab repository knowledge base',
      prompt:
        'Create a knowledge base that ingests GitLab project files, merge request descriptions, and issue threads, then build an agent I can ask things like "how does the billing module handle proration?" or "which MR introduced the rate limiter?" and get answers with GitLab citations.',
      modules: ['knowledge-base', 'agent'],
      category: 'engineering',
      tags: ['engineering', 'research', 'devops'],
    },
  ],
  skills: [
    {
      name: 'review-merge-request',
      description:
        'Fetch a GitLab merge request and post a structured review comment with actionable feedback.',
      content:
        '# Review Merge Request\n\nUse GitLab to read a merge request and leave a useful review.\n\n## Steps\n1. Get the merge request by project ID and MR IID to read its title, description, and changes.\n2. Assess the change for correctness, missing tests, and risky edits.\n3. Post a review note on the MR with Add MR Comment, summarizing the feedback.\n\n## Output\nConfirm the comment was posted and return a short summary: what looks good, what needs changes, and any blocking concerns.',
    },
    {
      name: 'triage-gitlab-issue',
      description:
        'Read a GitLab issue, classify it, and post a triage comment or update its fields.',
      content:
        '# Triage GitLab Issue\n\nUse GitLab to triage an incoming issue.\n\n## Steps\n1. Get the issue by project ID and issue IID to read its title and description.\n2. Classify it (bug, feature, question) and judge severity.\n3. Update the issue with the right labels and assignee using Update Issue, and add a triage note with Add Issue Comment.\n\n## Output\nReturn the classification, applied labels, assignee, and a one-line triage summary. Note any missing reproduction details.',
    },
    {
      name: 'monitor-pipeline-status',
      description:
        'Check GitLab pipeline status for a project and report failures, optionally retrying a failed pipeline.',
      content:
        '# Monitor Pipeline Status\n\nUse GitLab to keep an eye on CI pipelines.\n\n## Steps\n1. List pipelines for the project and identify the most recent runs.\n2. Get the pipeline details for any that failed to read the status and reason.\n3. If a failure looks transient, use Retry Pipeline to re-run it.\n\n## Output\nReturn a summary of recent pipeline runs (ref, status, when) and call out any failures. If a retry was triggered, include the retried pipeline ID.',
    },
  ],
} as const satisfies BlockMeta
