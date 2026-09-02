/** A context item as the agent receives it; skills carry their instructions in `content`. */
export interface AskModeAgentContext {
  type: 'skill'
  tag: string
  content: string
}

/** The request mode of an Ask turn, as the composer sends it. */
export const ASK_REQUEST_MODE = 'ask'

/**
 * The instructions an Ask turn carries. Rendered by the agent as an active
 * skill for the turn, alongside the knowledge bases the composer attached, so
 * the model searches them first and answers with citations, reaching a
 * connected service only when the indexed sources cannot answer.
 */
export const ASK_MODE_AGENT_CONTEXT: AskModeAgentContext = {
  type: 'skill',
  tag: '@Ask',
  content: [
    'The person chose Ask: they want an answer drawn from their connected sources, not an action.',
    '',
    '- Answer from the knowledge bases attached to this message first. Search them with the knowledge tool `query` operation, and search again with other phrasings when the first pass returns little. Do not read a base or its metadata first; search.',
    "- Reach for a connected integration only when the indexed sources cannot answer: live or very recent data (today's inbox, a calendar), or an action the person asked for outright. Say which service you used. Never build, run, or schedule anything on an Ask turn.",
    '- Cite every claim with a `<source>` tag exactly as the knowledge tool describes. When nothing relevant is found, say so plainly instead of guessing.',
    '- Keep the answer short: lead with the answer, then the supporting points.',
    '- Suggested follow-ups, when you offer them, are questions the attached sources can answer. Never suggest building, running, or automating anything.',
  ].join('\n'),
}

/** The turn's contexts with the Ask instructions appended when the request asked for Ask mode. */
export function withAskModeContext<T extends { type: string; content: string }>(
  contexts: T[],
  mode: string | undefined
): Array<T | AskModeAgentContext> {
  return mode === ASK_REQUEST_MODE ? [...contexts, ASK_MODE_AGENT_CONTEXT] : contexts
}
