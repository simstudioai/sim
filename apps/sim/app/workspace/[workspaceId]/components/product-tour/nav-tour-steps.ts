import type { Step } from 'react-joyride'

export const navTourSteps: Step[] = [
  {
    target: '[data-tour="nav-home"]',
    title: 'Home',
    content:
      'Your starting point. Describe what you want to build in plain language or pick a template to get started.',
    placement: 'right',
    disableBeacon: true,
    spotlightPadding: 0,
  },
  {
    target: '[data-tour="nav-search"]',
    title: 'Search',
    content: 'Quickly find workflows, blocks, and tools. Use Cmd+K to open it from anywhere.',
    placement: 'right',
    disableBeacon: true,
    spotlightPadding: 0,
  },
  {
    target: '[data-tour="nav-tables"]',
    title: 'Tables',
    content:
      'Store and query structured data. Your workflows can read and write to tables directly.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tour="nav-files"]',
    title: 'Files',
    content: 'Upload and manage files that your workflows can process, transform, or reference.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tour="nav-knowledge-base"]',
    title: 'Knowledge Base',
    content:
      'Build knowledge bases from your documents. Set up connectors to give your agents realtime access to your data sources from sources like Notion, Drive, Slack, Confluence, and more.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tour="nav-scheduled-tasks"]',
    title: 'Scheduled Tasks',
    content:
      'View and manage background tasks. Set up new tasks, or view the tasks the Mothership is monitoring for upcoming or past executions.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tour="nav-logs"]',
    title: 'Logs',
    content:
      'Monitor every workflow execution. See inputs, outputs, errors, and timing for each run. View analytics on performance and costs, filter previous runs, and view snapshots of the workflow at the time of execution.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tour="nav-tasks"]',
    title: 'Tasks',
    content:
      'Tasks that work for you. Mothership can create, edit, and delete resource throughout the platform. It can also perform actions on your behalf, like sending emails, creating tasks, and more.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tour="nav-workflows"]',
    title: 'Workflows',
    content:
      'All your workflows live here. Create new ones with the + button and organize them into folders. Deploy your workflows as API, webhook, schedule, or chat widget. Then hit Run to test it out.',
    placement: 'right',
    disableBeacon: true,
  },
]
