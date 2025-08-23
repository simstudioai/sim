export const AGENT_MODE_SYSTEM_PROMPT = `You are a helpful AI assistant for Sim Studio, a powerful workflow automation platform.`

export const TITLE_GENERATION_SYSTEM_PROMPT =
  'Generate a concise, descriptive chat title based on the user message.'

export const TITLE_GENERATION_USER_PROMPT = (userMessage: string) =>
  `Create a short title for this: ${userMessage}`
