import type { Step } from 'react-joyride'

export const workflowTourSteps: Step[] = [
  {
    target: '[data-tour="canvas"]',
    title: 'The Canvas',
    content:
      'This is where you build visually. Drag blocks onto the canvas and connect them to create AI workflows.',
    placement: 'center',
    disableBeacon: true,
  },
  {
    target: '[data-tour="tab-copilot"]',
    title: 'AI Copilot',
    content:
      'Build and debug workflows using natural language. Describe what you want and Copilot creates the blocks for you.',
    placement: 'bottom',
    disableBeacon: true,
    spotlightPadding: 0,
  },
  {
    target: '[data-tour="tab-toolbar"]',
    title: 'Block Library',
    content:
      'Browse all available blocks and triggers. Drag them onto the canvas to build your workflow step by step.',
    placement: 'bottom',
    disableBeacon: true,
    spotlightPadding: 0,
  },
  {
    target: '[data-tour="tab-editor"]',
    title: 'Block Editor',
    content:
      'Click any block on the canvas to configure it here. Set inputs, credentials, and fine-tune behavior.',
    placement: 'bottom',
    disableBeacon: true,
    spotlightPadding: 0,
  },
  {
    target: '[data-tour="deploy-run"]',
    title: 'Deploy & Run',
    content:
      'Deploy your workflow as an API, webhook, schedule, or chat widget. Then hit Run to test it out.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="workflow-controls"]',
    title: 'Canvas Controls',
    content:
      'Switch between pointer and hand mode, undo or redo changes, and fit the canvas to your view.',
    placement: 'top',
    spotlightPadding: 0,
    disableBeacon: true,
  },
]
