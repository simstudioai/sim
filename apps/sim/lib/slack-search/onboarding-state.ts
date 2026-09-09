import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { getRedisClient } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const TTL_SECONDS = 24 * 60 * 60
const stateSchema = z.object({
  turnId: z.string().min(1).max(200),
  email: z.string().email().max(320),
  slackUrl: z.string().url().max(3000),
  createdAt: z.number(),
})
export type SlackSearchOnboardingState = z.infer<typeof stateSchema>

function requireRedis() {
  const redis = getRedisClient()
  if (!redis) throw new Error('Slack onboarding requires Redis')
  return redis
}

function stateKey(token: string) {
  return `slack-search:onboarding:${sha256Hex(token)}`
}

/** Navigation proof only: every read and retry separately verifies the signed-in Slack sender. */
export async function storeSlackSearchOnboardingState(state: SlackSearchOnboardingState) {
  const token = generateId()
  const result = await requireRedis().set(
    stateKey(token),
    JSON.stringify(stateSchema.parse(state)),
    'EX',
    TTL_SECONDS,
    'NX'
  )
  if (result !== 'OK') throw new Error('Could not create Slack onboarding link')
  return token
}

export async function readSlackSearchOnboardingState(token: string) {
  const value = await requireRedis().get(stateKey(token))
  if (!value)
    throw new OrchestrationError(
      'validation',
      'This link expired. Send your question to the Slack bot again.'
    )
  const state = stateSchema.parse(JSON.parse(value))
  if (state.createdAt > Date.now() || Date.now() - state.createdAt >= TTL_SECONDS * 1000)
    throw new OrchestrationError(
      'validation',
      'This link expired. Send your question to the Slack bot again.'
    )
  return state
}
