import { DevinIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DevinBlockDisplay = {
  type: 'devin',
  name: 'Devin',
  description: 'Autonomous AI software engineer',
  category: 'tools',
  bgColor: '#12141A',
  icon: DevinIcon,
  longDescription:
    'Integrate Devin into your workflow. Create sessions to assign coding tasks, send messages to guide active sessions, and retrieve session status and results. Devin autonomously writes, runs, and tests code.',
  docsLink: 'https://docs.sim.ai/integrations/devin',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const DevinBlockMeta = {
  tags: ['agentic', 'automation'],
  url: 'https://devin.ai',
  templates: [
    {
      icon: DevinIcon,
      title: 'Devin session launcher',
      prompt:
        'Build a workflow that accepts a coding task description, creates a new Devin session with rich context, polls the session until it produces a pull request or hits a blocker, and posts the session link and status to Slack.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DevinIcon,
      title: 'Devin bug-fix dispatcher',
      prompt:
        'Create a workflow that watches for new critical errors, packages the stack trace and reproduction steps into a Devin prompt, creates a session, and updates a Linear ticket with the Devin session link and any pull requests it opens.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'devops'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: DevinIcon,
      title: 'Devin session monitor',
      prompt:
        'Build a scheduled workflow that runs every ten minutes, lists Devin sessions for your organization, tracks status changes, logs sessions, pull requests, and tags to a table, and sends a Slack alert when any session has been stuck for more than two hours.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring', 'agentic'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DevinIcon,
      title: 'Devin progress nudger',
      prompt:
        'Build a workflow that runs every hour against active Devin sessions, detects sessions that are suspended or awaiting input, sends a targeted follow-up message via the Devin API to unblock progress, and notifies the requester if a session needs human intervention.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'agentic', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DevinIcon,
      title: 'Documentation gap closer',
      prompt:
        'Create a workflow that scans a knowledge base of docs against the latest repo state, finds undocumented public APIs, opens a Devin session for each gap with a prompt to write documentation, and stores the produced markdown back into the knowledge base.',
      modules: ['knowledge-base', 'files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'content', 'agentic'],
    },
    {
      icon: DevinIcon,
      title: 'Devin retrospective report',
      prompt:
        'Build a scheduled weekly workflow that lists Devin sessions completed in the past week, summarizes outcomes, pull requests merged, time-to-completion, and recurring failure modes, and writes a retrospective report file shared with engineering leadership.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'reporting', 'analysis'],
    },
    {
      icon: DevinIcon,
      title: 'Devin issue-to-PR runner',
      prompt:
        'Create a workflow triggered when a Linear issue is labeled ready-for-devin that creates a Devin session with the issue context, monitors the session to completion, and comments the resulting pull request link back on the Linear issue.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation', 'agentic'],
      alsoIntegrations: ['linear'],
    },
  ],
  skills: [
    {
      name: 'start-engineering-session',
      description:
        'Create a Devin session with a clear engineering task prompt and report the session id and link.',
      content:
        '# Start a Devin Engineering Session\n\nKick off an autonomous engineering task with Devin.\n\n## Steps\n1. Confirm the repository and the task to perform.\n2. Write a precise prompt: the goal, constraints, and acceptance criteria.\n3. Create the session, optionally tagging it for tracking.\n4. Capture the session id and URL.\n\n## Output\nA confirmation with the session id, link, and the task prompt Devin was given.',
    },
    {
      name: 'check-session-progress',
      description:
        'Get a Devin session status and recent messages and summarize what it has accomplished or where it is blocked.',
      content:
        '# Check Devin Session Progress\n\nMonitor a running Devin session.\n\n## Steps\n1. Get the session for the given session id and read its status.\n2. List recent session messages to see Devin actions and reasoning.\n3. Determine whether it is making progress, finished, or blocked needing input.\n\n## Output\nA status summary describing progress, current state, and any questions Devin is waiting on.',
    },
    {
      name: 'guide-session',
      description:
        'Send a message to an active Devin session to answer a question or redirect its work.',
      content:
        '# Guide a Devin Session\n\nUnblock or steer an active session.\n\n## Steps\n1. Confirm the session id and review the latest messages.\n2. Compose a clear reply: answer the open question or give new direction.\n3. Send the message to the session.\n4. Confirm Devin has resumed.\n\n## Output\nA confirmation that the message was sent, with the guidance provided.',
    },
  ],
} as const satisfies BlockMeta
