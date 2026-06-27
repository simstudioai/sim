import { AzureIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AzureDevOpsBlockDisplay = {
  type: 'azure_devops',
  name: 'Azure DevOps',
  description: 'Interact with Azure DevOps pipelines, builds, and work items',
  category: 'tools',
  bgColor: '#0078D4',
  icon: AzureIcon,
  longDescription:
    'Integrate Azure DevOps into your workflow. List and inspect pipelines and builds, query and manage work items, and add or read comments.',
  docsLink: 'https://docs.sim.ai/integrations/azure_devops',
  integrationType: IntegrationType.DevOps,
  triggerAllowed: true,
} satisfies BlockDisplay

export const AzureDevOpsBlockMeta = {
  tags: ['version-control', 'ci-cd', 'project-management'],
  url: 'https://azure.microsoft.com/products/devops',
  templates: [
    {
      icon: AzureIcon,
      title: 'Azure DevOps build failure alerter',
      prompt:
        'Build a workflow triggered when an Azure DevOps build fails that fetches the build timeline and failing-stage logs, summarizes the root cause with an agent, and posts an actionable Slack alert with a deep link to the run.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps work-item triager',
      prompt:
        'Create a workflow triggered when an Azure DevOps work item is created that classifies it by type and priority, enriches the description, assigns the right area path, and posts a summary to the team channel.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'project-management', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps release notes generator',
      prompt:
        'Build a workflow that pulls the work items completed between two Azure DevOps builds, groups them by type with an agent, and writes formatted release notes to a file for the release manager.',
      modules: ['agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting', 'engineering'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps pipeline health report',
      prompt:
        'Create a scheduled daily workflow that lists Azure DevOps pipeline runs, computes pass rate and average duration per pipeline, logs them to a table for trend tracking, and Slacks a morning summary highlighting any regressions.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps to Linear bridge',
      prompt:
        'Build a workflow that watches new Azure DevOps work items, mirrors each as a Linear issue with full context and a back-link, and keeps the team aligned across both trackers.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'project-management'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps PR review summarizer',
      prompt:
        'Create a workflow triggered on a new Azure DevOps pull request that fetches the diff and linked work items, drafts a concise review summary and risk callouts with an agent, and posts it as a PR comment for reviewers.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'engineering', 'automation'],
    },
    {
      icon: AzureIcon,
      title: 'Azure DevOps sprint burndown digest',
      prompt:
        'Build a scheduled daily workflow that queries Azure DevOps work items in the active sprint, computes remaining effort and at-risk items, logs the burndown to a table, and posts a morning summary to the team Slack channel.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'project-management', 'reporting'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'triage-build-failure',
      description:
        'Investigate a failed Azure DevOps build, pinpoint the failing stage, and summarize the root cause. Use when a pipeline run breaks.',
      content:
        '# Triage Build Failure\n\nDiagnose why an Azure DevOps build failed.\n\n## Steps\n1. Use Get Build Timeline for the build id to find which stage, job, or task failed.\n2. Use List Build Logs to locate the log id for the failing step, then Get Build Log to read its contents.\n3. Scan the log for the first error, the failing command, and the exit code; ignore noise after the initial failure.\n4. Optionally use Get Work Items Between Builds against the last successful build to see what changed.\n\n## Output\nReturn a concise root-cause summary: the failing stage/task, the key error line, the likely cause, and a suggested next action. Include a deep link to the run when available.',
    },
    {
      name: 'create-work-item',
      description:
        'Create a new Azure DevOps work item (Issue, Task, or Epic) with the right fields. Use to file bugs, tasks, or features from another system.',
      content:
        '# Create Work Item\n\nFile a structured Azure DevOps work item.\n\n## Steps\n1. Choose the work item type: Issue, Task, or Epic, matching the request.\n2. Use Create Work Item with a clear title and an HTML or plain-text description.\n3. Set context fields where known: assignee, priority (1-4), area path, iteration path, and semicolon-separated tags.\n4. For a Task, set Activity, Remaining Work, and Completed Work; for an Epic, set Start Date and Target Date.\n\n## Output\nReturn the new work item id, type, title, state, and a link. Confirm the assignee and iteration. If a required field is missing, ask for it rather than guessing.',
    },
    {
      name: 'generate-release-notes',
      description:
        'Compile release notes from the work items completed between two Azure DevOps builds. Use at release time to summarize what shipped.',
      content:
        '# Generate Release Notes\n\nProduce release notes for a build range.\n\n## Steps\n1. Identify the From Build ID (previous release) and To Build ID (current release).\n2. Use Get Work Items Between Builds to list the associated work items.\n3. For each work item, use Get Work Items Batch or Get Work Item to pull title, type, and state.\n4. Group items by type (Features/Epics, Tasks, Bugs/Issues) and write a one-line summary per item.\n\n## Output\nReturn formatted Markdown release notes grouped by category, each line linking the work item id and title. Add a short headline summary of the most user-facing changes at the top.',
    },
    {
      name: 'report-pipeline-health',
      description:
        'Summarize recent Azure DevOps pipeline run results to surface pass rate and regressions. Use for daily or weekly engineering health reports.',
      content:
        '# Report Pipeline Health\n\nSummarize recent pipeline reliability.\n\n## Steps\n1. Use List Pipelines to enumerate the pipelines you care about.\n2. For each, use List Pipeline Runs to pull recent runs within your window.\n3. Compute pass rate (succeeded vs total), average duration, and the count of recent failures per pipeline.\n4. Flag pipelines whose pass rate dropped or whose duration increased noticeably versus prior runs.\n\n## Output\nReturn a per-pipeline summary table (name, pass rate, avg duration, recent failures) and a short narrative calling out regressions and any pipeline that is consistently red.',
    },
  ],
} as const satisfies BlockMeta
