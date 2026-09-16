const THINKING_AT = 320
/** Allow the production loader's entry hold and goo morph to play before agent activity starts. */
const AGENT_AT = THINKING_AT + 4_200
const STAGE_OPEN_AT = AGENT_AT + 600

/** Shared ordering for the homepage and Build agents preview: think, dispatch, build, reply. */
export const PREVIEW_BUILD_TIMING = {
  thinkingAt: THINKING_AT,
  dispatchAt: AGENT_AT - 650,
  agentAt: AGENT_AT,
  stageOpenAt: STAGE_OPEN_AT,
  blockStartAt: STAGE_OPEN_AT + 550,
  blockStepMs: 420,
  replyPauseMs: 500,
} as const
