import type { Step } from 'react-joyride'

export const navTourSteps: Step[] = [
  {
    target: '[data-item-id="home"]',
    title: 'Home',
    content:
      'Your starting point. Describe what you want to build in plain language or pick a template to get started.',
    placement: 'right',
    disableBeacon: true,
    spotlightPadding: 0,
  },
  {
    target: '[data-item-id="search"]',
    title: 'Search',
    content: 'Quickly find workflows, blocks, and tools. Use Cmd+K to open it from anywhere.',
    placement: 'right',
    disableBeacon: true,
    spotlightPadding: 0,
  },
  {
    target: '[data-item-id="tables"]',
    title: 'Tables',
    content:
      'Store and query structured data. Your workflows can read and write to tables directly.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-item-id="files"]',
    title: 'Files',
    content: 'Upload and manage files that your workflows can process, transform, or reference.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-item-id="knowledge-base"]',
    title: 'Knowledge Base',
    content:
      'Build knowledge bases from your documents. Agents use these to answer questions with your own data.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-item-id="scheduled-tasks"]',
    title: 'Scheduled Tasks',
    content:
      'View and manage workflows running on a schedule. Monitor upcoming and past executions.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-item-id="logs"]',
    title: 'Logs',
    content:
      'Monitor every workflow execution. See inputs, outputs, errors, and timing for each run.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '.workflows-section',
    title: 'Workflows',
    content:
      'All your workflows live here. Create new ones with the + button and organize them into folders.',
    placement: 'right',
    disableBeacon: true,
  },
]
