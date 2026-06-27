import { Calendar } from '@/components/emcn/icons'
import { GithubIcon, NotionIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const GitHubBlockDisplay = {
  type: 'github',
  name: 'GitHub (Legacy)',
  description: 'Interact with GitHub or trigger workflows from GitHub events',
  category: 'tools',
  bgColor: '#181C1E',
  icon: GithubIcon,
  longDescription:
    'Integrate Github into the workflow. Can get get PR details, create PR comment, get repository info, and get latest commit. Can be used in trigger mode to trigger a workflow when a PR is created, commented on, or a commit is pushed.',
  docsLink: 'https://docs.sim.ai/integrations/github',
  integrationType: IntegrationType.DevOps,
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay

export const GitHubV2BlockDisplay = {
  ...GitHubBlockDisplay,
  type: 'github_v2',
  name: 'GitHub',
  integrationType: IntegrationType.DevOps,
  hideFromToolbar: false,
} satisfies BlockDisplay

export const GitHubBlockMeta = {
  tags: ['version-control', 'ci-cd'],
  url: 'https://github.com',
  templates: [
    {
      icon: GithubIcon,
      title: 'PR review assistant',
      prompt:
        'Create a knowledge base connected to my GitHub repo so it stays synced with my style guide and coding standards. Then build a workflow that reviews new pull requests against it, checks for common issues and security vulnerabilities, and posts a review comment with specific suggestions.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: GithubIcon,
      title: 'Changelog generator',
      prompt:
        'Build a scheduled workflow that runs every Friday, pulls all merged PRs from GitHub for the week, categorizes changes as features, fixes, or improvements, and generates a user-facing changelog document with clear descriptions.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'product', 'reporting', 'content'],
    },
    {
      icon: NotionIcon,
      title: 'Documentation auto-updater',
      prompt:
        'Create a knowledge base connected to my GitHub repository so code and docs stay synced. Then build a scheduled weekly workflow that detects API changes, compares them against the knowledge base to find outdated documentation, and either updates Notion pages directly or creates Linear tickets for the needed changes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync', 'automation'],
      alsoIntegrations: ['notion', 'linear'],
    },
    {
      icon: GithubIcon,
      title: 'GitHub repository search',
      prompt:
        'Create a knowledge base connected to my GitHub repository so all source files, READMEs, and pull request descriptions are automatically synced and searchable. Then build an agent I can ask things like "where do we handle Stripe webhooks?" or "what changed in the auth module last month?" and get answers with file and PR citations.',
      modules: ['knowledge-base', 'agent'],
      category: 'engineering',
      tags: ['engineering', 'research', 'devops'],
    },
    {
      icon: GithubIcon,
      title: 'Release notes drafter',
      prompt:
        'Build a workflow triggered when a GitHub release tag is created. Pull every merged pull request and commit since the previous tag, group them by feature, fix, and chore, draft customer-facing release notes, and post the draft as a comment on the release for final approval.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'content', 'devops'],
    },
    {
      icon: Calendar,
      title: 'Weekly team digest',
      prompt:
        "Build a scheduled workflow that runs every Friday, pulls the week's GitHub commits, closed Linear issues, and key Slack conversations, then emails a formatted weekly summary to the team.",
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['engineering', 'team', 'reporting'],
      alsoIntegrations: ['linear', 'slack'],
    },

    {
      icon: GithubIcon,
      title: 'Link GitHub pull requests to Jira tickets',
      prompt:
        'Build a workflow that monitors GitHub pull requests and automatically transitions linked Jira issues when PRs are opened or merged, keeping your project board accurate without any manual updates.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['jira'],
    },
    {
      icon: GithubIcon,
      title: 'Sync GitHub events with Linear issues',
      prompt:
        'Build a workflow that creates Linear issues from GitHub pull requests and commits, and automatically updates their status when a PR is merged.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['linear'],
    },
    {
      icon: GithubIcon,
      title: 'Get GitHub activity alerts in Slack',
      prompt:
        'Create an agent that watches GitHub for new pull requests, commits, issues, or deployments and posts formatted Slack notifications so your engineering team never misses a critical event.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'review-pull-request',
      description:
        'Fetch a GitHub PR, its changed files, and diff, then post a structured review comment.',
      content:
        '# Review Pull Request\n\nUse GitHub to read a pull request and leave a useful review.\n\n## Steps\n1. Get PR details for the given owner, repo, and PR number to read the title, description, and status.\n2. Get the PR files to see the changed paths and diffs.\n3. Assess the changes for correctness, missing tests, and risky edits.\n4. Post a PR comment summarizing the review with specific, actionable feedback.\n\n## Output\nConfirm the comment was posted and return a short summary of the findings: what looks good, what needs changes, and any blocking concerns.',
    },
    {
      name: 'triage-new-issue',
      description:
        'Read a GitHub issue, classify it, apply labels, and assign it to the right owner.',
      content:
        '# Triage New Issue\n\nUse GitHub to triage an incoming issue.\n\n## Steps\n1. Get the issue by owner, repo, and issue number to read its title and body.\n2. Classify it (bug, feature, question, docs) and judge its severity.\n3. Add the appropriate labels with Add issue labels.\n4. Assign the issue to the relevant owner with Add issue assignees.\n\n## Output\nReturn the applied labels, the assignee, and a one-line triage summary. If the issue lacks reproduction details, note what information is missing.',
    },
    {
      name: 'summarize-repo-activity',
      description:
        'Pull recent GitHub PRs, commits, and issues for a repo and produce a concise activity digest.',
      content:
        '# Summarize Repo Activity\n\nUse GitHub to build a status digest for a repository.\n\n## Steps\n1. List open pull requests and recent issues for the owner and repo.\n2. Get the latest commit to anchor the digest in time.\n3. Group activity into in-progress work, newly opened items, and anything stalled or awaiting review.\n\n## Output\nReturn a digest with three sections: open PRs (title, author, status), notable issues, and the latest commit. Keep it short enough to drop into a standup or Slack channel.',
    },
    {
      name: 'open-pull-request-with-changes',
      description:
        'Create a branch, commit a file change, and open a GitHub pull request for review.',
      content:
        '# Open Pull Request With Changes\n\nUse GitHub to land a change as a reviewable PR.\n\n## Steps\n1. Create a new branch off the default branch with Create branch.\n2. Create or update the target file on that branch with Create file or Update file, including a clear commit message.\n3. Open a pull request from the new branch with Create pull request, writing a descriptive title and body.\n4. Optionally request reviewers with Request PR reviewers.\n\n## Output\nReturn the new PR number and URL, the branch name, and the files changed so the requester can track it to merge.',
    },
  ],
} as const satisfies BlockMeta

export const GitHubV2BlockMeta = {
  tags: ['version-control', 'ci-cd'],
  url: 'https://github.com',
} as const satisfies BlockMeta
