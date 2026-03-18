import type { Step } from 'react-joyride'

export const tourSteps: Step[] = [
  {
    target: '[data-tour="home-greeting"]',
    title: 'Welcome to Sim',
    content:
      'This is your home base. From here you can describe what you want to build in plain language, or pick a template to get started.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="home-chat-input"]',
    title: 'Describe your workflow',
    content:
      'Type what you want to automate — like "monitor my inbox and summarize new emails." Sim will build an AI workflow for you.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="home-templates"]',
    title: 'Start from a template',
    content:
      'Or pick one of these pre-built templates to ship your agent in minutes. Click any card to get started.',
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '.sidebar-container',
    title: 'Sidebar navigation',
    content:
      'Access everything from here — workflows, tables, files, knowledge base, and logs. This stays with you across all pages.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-item-id="search"]',
    title: 'Search anything',
    content: 'Use search (or Cmd+K) to quickly find workflows, blocks, tools, and more.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '.workflows-section',
    title: 'Your workflows',
    content:
      'All your workflows live here. Create new ones with the + button, organize with folders, and switch between them.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tour="canvas"]',
    title: 'The workflow canvas',
    content:
      'This is where you build visually. Drag blocks onto the canvas and connect them together to create AI workflows.',
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tour="command-list"]',
    title: 'Quick actions',
    content:
      'Use these keyboard shortcuts to get started fast. Try Cmd+K to search for blocks, or Cmd+Y to browse templates.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '[data-tab-button="toolbar"]',
    title: 'Block library',
    content:
      'The Toolbar is your block library. Drag triggers and blocks onto the canvas to build your workflow step by step.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tab-button="copilot"]',
    title: 'AI Copilot',
    content:
      'Copilot helps you build and debug workflows using natural language. Describe what you want and it creates blocks for you.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tab-button="editor"]',
    title: 'Block editor',
    content:
      'Click any block on the canvas to configure it here — set inputs, credentials, and fine-tune behavior.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="deploy-run"]',
    title: 'Run and deploy',
    content:
      'Hit Run to execute your workflow and see results in the terminal below. When ready, Deploy as an API, webhook, schedule, or chat widget.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="workflow-controls"]',
    title: 'Canvas controls',
    content:
      'Switch between pointer and hand mode, undo/redo changes, and fit your canvas to view.',
    placement: 'top',
    disableBeacon: true,
  },
]
