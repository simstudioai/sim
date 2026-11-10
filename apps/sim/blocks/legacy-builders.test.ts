import { describe, expect, it } from 'vitest'
import { DiscordBlock } from '@/blocks/blocks/discord'
import { ExtendV2Block } from '@/blocks/blocks/extend'
import { Mem0Block } from '@/blocks/blocks/mem0'
import { PulseV2Block } from '@/blocks/blocks/pulse'
import { ReductoV2Block } from '@/blocks/blocks/reducto'
import { S3Block } from '@/blocks/blocks/s3'
import { TelegramBlock } from '@/blocks/blocks/telegram'
import { TextractV2Block } from '@/blocks/blocks/textract'
import { ZepBlock } from '@/blocks/blocks/zep'
import type { BlockConfig } from '@/blocks/types'

/**
 * Legacy blocks whose params builder was extracted so a credential-only
 * successor could skip the secret check. Existing workflows still run these
 * builders, so their secret handling must stay exactly as it was: the same
 * error when the secret is missing, and the secret passed through unchanged
 * (or trimmed, where it always was).
 */
const file = {
  name: 'doc.pdf',
  key: 'k',
  url: 'https://files.example.com/doc.pdf',
  size: 1,
  type: 'application/pdf',
}
const base = {
  file,
  document: file,
  region: 'us-east-1',
  s3Uri: 'https://bucket.s3.us-east-1.amazonaws.com/key',
  serverId: 'server',
  channelId: 'channel',
  content: 'hello',
  userId: 'user',
  threadId: 'thread',
}

const cases: Array<{
  block: BlockConfig
  missingSecretError: string | RegExp
  secret: Record<string, string>
  sent: Record<string, string>
  values?: Record<string, unknown>
}> = [
  {
    block: S3Block,
    missingSecretError: 'Access Key ID is required',
    secret: { accessKeyId: ' A ', secretAccessKey: ' S ' },
    sent: { accessKeyId: ' A ', secretAccessKey: ' S ' },
  },
  {
    block: TextractV2Block,
    missingSecretError: 'AWS Access Key ID is required',
    secret: { accessKeyId: ' A ', secretAccessKey: ' S ' },
    sent: { accessKeyId: 'A', secretAccessKey: 'S' },
  },
  {
    block: Mem0Block,
    missingSecretError: 'Mem0 Block Error: API Key is required',
    secret: { apiKey: ' K ' },
    sent: { apiKey: ' K ' },
    values: { operation: 'search', query: 'q' },
  },
  {
    block: ZepBlock,
    missingSecretError: 'Zep Block Error: API Key is required',
    secret: { apiKey: ' K ' },
    sent: { apiKey: ' K ' },
  },
  {
    block: DiscordBlock,
    missingSecretError: 'Bot token is required',
    secret: { botToken: 'B' },
    sent: { botToken: 'B' },
    values: { operation: 'discord_send_message' },
  },
  {
    block: TelegramBlock,
    missingSecretError: 'Bot token required for this operation',
    secret: { botToken: 'B' },
    sent: { botToken: 'B' },
    values: { operation: 'telegram_message', chatId: 'chat', text: 'hi' },
  },
  ...[ExtendV2Block, PulseV2Block, ReductoV2Block].map((block) => ({
    block,
    missingSecretError: /trim/,
    secret: { apiKey: ' K ' },
    sent: { apiKey: 'K' },
  })),
]

describe.each(cases)('$block.type legacy params builder', (testCase) => {
  const build = (values: Record<string, unknown>) =>
    testCase.block.tools.config?.params?.({ ...base, ...testCase.values, ...values })

  it('still refuses to run without its secret', () => {
    expect(() => build({})).toThrow(testCase.missingSecretError)
  })

  it('still sends the secret exactly as it always did', () => {
    expect(build(testCase.secret)).toMatchObject(testCase.sent)
  })
})
