import { CursorIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const CursorBlockDisplay = {
  type: 'cursor',
  name: 'Cursor (Legacy)',
  description: 'Launch and manage Cursor cloud agents to work on GitHub repositories',
  category: 'tools',
  bgColor: '#1E1E1E',
  icon: CursorIcon,
  longDescription:
    'Interact with Cursor Cloud Agents API to launch AI agents that can work on your GitHub repositories. Supports launching agents, adding follow-up instructions, checking status, viewing conversations, and managing agent lifecycle.',
  docsLink: 'https://cursor.com/docs/cloud-agent/api/endpoints',
  integrationType: IntegrationType.DevOps,
  hideFromToolbar: true,
} satisfies BlockDisplay

export const CursorV2BlockDisplay = {
  ...CursorBlockDisplay,
  type: 'cursor_v2',
  name: 'Cursor',
  description: 'Launch and manage Cursor cloud agents to work on GitHub repositories',
  longDescription:
    'Interact with Cursor Cloud Agents API to launch AI agents that can work on your GitHub repositories. Supports launching agents, adding follow-up instructions, checking status, viewing conversations, and managing agent lifecycle.',
  hideFromToolbar: false,
} satisfies BlockDisplay

export const CursorBlockMeta = {
  tags: ['agentic', 'automation'],
  url: 'https://cursor.com',
  templates: [
    {
      icon: CursorIcon,
      title: 'Cursor cloud agent launcher',
      prompt:
        'Build a workflow that takes a feature description and a GitHub repository, launches a Cursor cloud agent with structured instructions, polls until the agent finishes, captures the generated pull request link, and posts a summary to Slack so the team can review.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CursorIcon,
      title: 'Cursor issue-to-PR pipeline',
      prompt:
        'Create a workflow that fires when a GitHub issue is labeled "auto-fix", crafts a precise prompt from the issue description, launches a Cursor cloud agent on the repository, monitors progress, and comments on the issue with the resulting pull request and conversation summary.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: CursorIcon,
      title: 'Cursor agent fleet monitor',
      prompt:
        'Build a scheduled workflow that runs every fifteen minutes, lists all active Cursor cloud agents, logs status, runtime, and repository to a tracking table, and posts a daily Slack summary of completed, failing, and long-running agents.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring', 'agentic'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CursorIcon,
      title: 'Test fix delegator',
      prompt:
        'Build a workflow triggered by a failing GitHub Actions test run that extracts the failing test name and error, launches a targeted Cursor cloud agent to fix only that test, downloads the artifact diff when ready, and replies on the failed run with the proposed patch.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: CursorIcon,
      title: 'Refactor follow-up loop',
      prompt:
        'Create a workflow that picks up review comments on a Cursor-authored pull request, formulates each comment as a follow-up instruction, sends them to the originating Cursor cloud agent, and waits for the updated diff before re-requesting review.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: CursorIcon,
      title: 'Cursor agent conversation archiver',
      prompt:
        'Build a scheduled daily workflow that lists completed Cursor cloud agents, fetches each conversation history, stores the transcripts and produced artifacts as files, and updates a tracking table with prompts, durations, and outcomes for retrospective analysis.',
      modules: ['scheduled', 'files', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'analysis'],
    },
    {
      icon: CursorIcon,
      title: 'Stuck-agent cleaner',
      prompt:
        'Create a scheduled workflow that runs hourly, lists Cursor cloud agents, detects agents stuck in the same state longer than a configurable threshold, stops or deletes them based on rules, and posts a Slack report of the cleanup actions taken.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'launch-coding-agent',
      description:
        'Launch a Cursor cloud agent on a GitHub repository with a clear task prompt and report the agent id and starting status.',
      content:
        '# Launch a Cursor Coding Agent\n\nKick off an autonomous Cursor agent to work on a repo.\n\n## Steps\n1. Confirm the target repository and the task to perform.\n2. Write a precise prompt: what to change, constraints, and acceptance criteria.\n3. Launch the agent with the chosen model and repository.\n4. Capture the agent id and initial status.\n\n## Output\nA confirmation with the agent id, repository, and the task prompt it was given.',
    },
    {
      name: 'track-agent-progress',
      description:
        'Poll a Cursor agent for status and conversation updates and summarize what it has done so far.',
      content:
        '# Track Cursor Agent Progress\n\nMonitor a running Cursor agent.\n\n## Steps\n1. Get the agent status for the given agent id.\n2. Pull the conversation to see the latest actions and reasoning.\n3. If the agent is finished, list its artifacts; if blocked, identify why.\n\n## Output\nA status summary describing progress, current state, and any blockers or produced artifacts.',
    },
    {
      name: 'send-agent-followup',
      description:
        'Send a follow-up instruction to an in-progress Cursor agent to refine or redirect its work.',
      content:
        '# Send a Cursor Agent Follow-up\n\nGuide an active agent with additional instructions.\n\n## Steps\n1. Confirm the agent id and review its recent conversation.\n2. Compose a clear follow-up message addressing what to change or add.\n3. Add the follow-up to the agent.\n4. Note that the agent has resumed work.\n\n## Output\nA confirmation that the follow-up was delivered, with the instruction sent.',
    },
  ],
} as const satisfies BlockMeta
