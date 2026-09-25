import { vi } from 'vitest'

const INLINE_ATTACHMENT_THRESHOLD_BYTES = 10 * 1024 * 1024
const MEBIBYTE = 1024 * 1024

const ATTACHMENT_PROVIDER_BY_ID: Record<string, string> = {
  openai: 'openai',
  'azure-openai': 'openai',
  anthropic: 'anthropic',
  'azure-anthropic': 'anthropic',
  google: 'google',
  vertex: 'google',
  bedrock: 'bedrock',
  openrouter: 'openrouter',
  mistral: 'mistral',
  groq: 'groq',
  fireworks: 'fireworks',
  together: 'together',
  baseten: 'baseten',
  ollama: 'ollama',
  'ollama-cloud': 'ollama',
  vllm: 'vllm',
  litellm: 'litellm',
  xai: 'xai',
  deepseek: 'deepseek',
  cerebras: 'cerebras',
  sakana: 'sakana',
  nvidia: 'nvidia',
  meta: 'meta',
  zai: 'zai',
  kimi: 'kimi',
}

const UNSUPPORTED_FILE_PROVIDERS = new Set([
  'deepseek',
  'cerebras',
  'sakana',
  'nvidia',
  'meta',
  'zai',
])

function getAttachmentProvider(providerId: string): string | null {
  return Object.hasOwn(ATTACHMENT_PROVIDER_BY_ID, providerId)
    ? ATTACHMENT_PROVIDER_BY_ID[providerId]
    : null
}

/**
 * Controllable mock functions for `@/providers/attachments`.
 *
 * Defaults:
 * - `formatMessagesForProvider(messages)` returns `messages` unchanged (what every provider test
 *   stubs); `prepareProviderAttachments` → `[]`;
 * - `getAttachmentProvider` / `supportsFileAttachments` / `formatAttachmentSizes` are faithful
 *   ports of the real pure logic;
 * - the strategy helpers answer as for the real default `'inline'` policy:
 *   `getProviderFileStrategy` → `'inline'`, `shouldUseLargeFilePath` → `false`,
 *   `getProviderAttachmentMaxBytes` → 10 MiB, `isProviderAttachmentFilenameModelBound` → `false`;
 * - `inferAttachmentMimeType` and the `build*MessageContent` / `buildGeminiMessageParts` builders
 *   are bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { providersAttachmentsMockFns } from '@sim/testing/mocks/providers-attachments.mock'
 *
 * expect(providersAttachmentsMockFns.mockFormatMessagesForProvider).toHaveBeenCalledWith(messages, 'groq')
 * ```
 */
export const providersAttachmentsMockFns = {
  mockGetProviderFileStrategy: vi.fn(
    (_providerId: string): 'inline' | 'files-api' | 'remote-url' => 'inline'
  ),
  mockShouldUseLargeFilePath: vi.fn((_file: unknown, _providerId: string): boolean => false),
  mockGetAttachmentProvider: vi.fn(getAttachmentProvider),
  mockSupportsFileAttachments: vi.fn((providerId: string): boolean => {
    const provider = getAttachmentProvider(providerId)
    return Boolean(provider && !UNSUPPORTED_FILE_PROVIDERS.has(provider))
  }),
  mockGetProviderAttachmentMaxBytes: vi.fn(
    (_providerId: string): number => INLINE_ATTACHMENT_THRESHOLD_BYTES
  ),
  mockFormatAttachmentSizes: vi.fn(
    (bytes: number, limitBytes: number): { size: string; limit: string } => {
      const divisor = limitBytes % MEBIBYTE === 0 ? MEBIBYTE : 1_000_000
      const render = (value: number, round: (n: number) => number) => {
        const scaled = round((value / divisor) * 100) / 100
        return Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(2)
      }
      return { size: render(bytes, Math.ceil), limit: render(limitBytes, Math.floor) }
    }
  ),
  mockInferAttachmentMimeType: vi.fn(),
  mockIsProviderAttachmentFilenameModelBound: vi.fn(
    (_file: unknown, _providerId: string, _options?: unknown): boolean => false
  ),
  mockPrepareProviderAttachments: vi.fn((..._args: unknown[]): unknown[] => []),
  mockBuildOpenAIMessageContent: vi.fn(),
  mockBuildAnthropicMessageContent: vi.fn(),
  mockBuildGeminiMessageParts: vi.fn(),
  mockBuildOpenAICompatibleChatContent: vi.fn(),
  mockBuildOpenRouterMessageContent: vi.fn(),
  mockBuildBedrockMessageContent: vi.fn(),
  mockFormatMessagesForProvider: vi.fn(
    <T>(messages: T, _providerId?: string, _projectFilename?: unknown): T => messages
  ),
}

/**
 * Static mock module for `@/providers/attachments`. Covers every runtime export; the size constants
 * carry the real values (`INLINE_ATTACHMENT_THRESHOLD_BYTES` 10 MiB,
 * `LARGE_FILE_PATH_THRESHOLD_BYTES` 6 MiB).
 *
 * @example
 * ```ts
 * vi.mock('@/providers/attachments', () => providersAttachmentsMock)
 * ```
 */
export const providersAttachmentsMock = {
  INLINE_ATTACHMENT_THRESHOLD_BYTES,
  LARGE_FILE_PATH_THRESHOLD_BYTES: Math.floor((8 * 1024 * 1024) / 4) * 3,
  getProviderFileStrategy: providersAttachmentsMockFns.mockGetProviderFileStrategy,
  shouldUseLargeFilePath: providersAttachmentsMockFns.mockShouldUseLargeFilePath,
  getAttachmentProvider: providersAttachmentsMockFns.mockGetAttachmentProvider,
  supportsFileAttachments: providersAttachmentsMockFns.mockSupportsFileAttachments,
  getProviderAttachmentMaxBytes: providersAttachmentsMockFns.mockGetProviderAttachmentMaxBytes,
  formatAttachmentSizes: providersAttachmentsMockFns.mockFormatAttachmentSizes,
  inferAttachmentMimeType: providersAttachmentsMockFns.mockInferAttachmentMimeType,
  isProviderAttachmentFilenameModelBound:
    providersAttachmentsMockFns.mockIsProviderAttachmentFilenameModelBound,
  prepareProviderAttachments: providersAttachmentsMockFns.mockPrepareProviderAttachments,
  buildOpenAIMessageContent: providersAttachmentsMockFns.mockBuildOpenAIMessageContent,
  buildAnthropicMessageContent: providersAttachmentsMockFns.mockBuildAnthropicMessageContent,
  buildGeminiMessageParts: providersAttachmentsMockFns.mockBuildGeminiMessageParts,
  buildOpenAICompatibleChatContent:
    providersAttachmentsMockFns.mockBuildOpenAICompatibleChatContent,
  buildOpenRouterMessageContent: providersAttachmentsMockFns.mockBuildOpenRouterMessageContent,
  buildBedrockMessageContent: providersAttachmentsMockFns.mockBuildBedrockMessageContent,
  formatMessagesForProvider: providersAttachmentsMockFns.mockFormatMessagesForProvider,
}
