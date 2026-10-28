import { sha256Hex } from '@sim/security/hash'
import { defineOperation } from '@/lib/core/application'
import { getRedisClient } from '@/lib/core/config/redis'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'

const REQUEST_TTL_SECONDS = 600
const MAX_REQUEST_BYTES = 32_768
const CONSUME = `
local value = redis.call('GET', KEYS[1])
if not value then return nil end
local request = cjson.decode(value)
if request.userId ~= ARGV[1] then return nil end
redis.call('DEL', KEYS[1])
return request.encrypted
`

function redis() {
  const client = getRedisClient()
  if (!client) throw new Error('Desktop connections require Redis')
  return client
}

function requestKey(requestId: string) {
  return `desktop:source-request:${sha256Hex(requestId)}`
}

/** Transports an intent only; the browser must still call the source's authorized operation. */
export const createDesktopSourceRequest = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: Transporting caller intent grants no source access; the target operation authorizes it.
  operation: defineOperation({
    id: 'desktop.source_requests.create',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: { userId: string }
    input: { requestId: string; payload: string }
  }) {
    if (Buffer.byteLength(input.payload, 'utf8') > MAX_REQUEST_BYTES)
      throw new OrchestrationError('validation', 'Connection request is too large')
    const { requestId } = input
    if (!/^[A-Za-z0-9_-]{32}$/.test(requestId))
      throw new OrchestrationError('validation', 'Invalid connection request')
    const { encrypted } = await encryptSecret(input.payload)
    const saved = await redis().set(
      requestKey(requestId),
      JSON.stringify({ userId: principal.userId, encrypted }),
      'EX',
      REQUEST_TTL_SECONDS,
      'NX'
    )
    if (saved !== 'OK') throw new Error('Could not prepare the connection request')
    return { requestId }
  },
})

/** The same account may redeem once in its browser session; other accounts cannot consume it. */
export const consumeDesktopSourceRequest = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: Only the owner's intent is returned; source authorization remains at the target operation.
  operation: defineOperation({
    id: 'desktop.source_requests.consume',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: { userId: string }
    input: { requestId: string }
  }) {
    const encrypted = await redis().eval(CONSUME, 1, requestKey(input.requestId), principal.userId)
    if (typeof encrypted !== 'string')
      throw new OrchestrationError(
        'not_found',
        'Connection request expired. Start again from the desktop app.'
      )
    return { payload: (await decryptSecret(encrypted)).decrypted }
  },
})
