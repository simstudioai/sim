export type CopilotModelId = string

export const COPILOT_MODES = ['ask', 'build', 'plan'] as const
export type CopilotMode = (typeof COPILOT_MODES)[number]

export const COPILOT_TRANSPORT_MODES = ['ask', 'agent', 'plan'] as const
export type CopilotTransportMode = (typeof COPILOT_TRANSPORT_MODES)[number]

export const COPILOT_REQUEST_MODES = ['ask', 'build', 'plan', 'agent'] as const
export type CopilotRequestMode = (typeof COPILOT_REQUEST_MODES)[number]
