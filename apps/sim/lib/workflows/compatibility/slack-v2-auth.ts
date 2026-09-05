import { omit } from '@sim/utils/object'
import type { BlockState, SubBlockState } from '@sim/workflow-types/workflow'
import { isNonEmptyValue } from '@/lib/workflows/subblocks/visibility'

type CanonicalMode = 'basic' | 'advanced'

function resolveLegacyMode(
  override: CanonicalMode | undefined,
  basicValue: unknown,
  advancedValue: unknown
): CanonicalMode {
  if (override === 'basic' || override === 'advanced') return override
  return !isNonEmptyValue(basicValue) && isNonEmptyValue(advancedValue) ? 'advanced' : 'basic'
}

function withValue(
  subBlock: SubBlockState | undefined,
  id: string,
  type: SubBlockState['type'],
  value: SubBlockState['value']
): SubBlockState {
  return { ...(subBlock ?? { id, type }), value }
}

/**
 * Projects the preview-era slack_v2 action auth shape into the merged credential picker added in
 * 5be35b5. The returned view is safe for current readers but is never marked for persistence, so
 * frozen deployment snapshots and normalized workflow rows remain unchanged.
 */
export function projectLegacySlackV2Auth(
  blocks: Record<string, BlockState>
): Record<string, BlockState> {
  let projectedBlocks: Record<string, BlockState> | undefined

  for (const [blockId, block] of Object.entries(blocks)) {
    if (block.type !== 'slack_v2' || block.triggerMode) continue

    const authMethod = block.subBlocks.authMethod?.value
    if (authMethod !== 'oauth' && authMethod !== 'bot_token') continue

    const canonicalModes = block.data?.canonicalModes ?? {}
    const oauthMode = resolveLegacyMode(
      canonicalModes.oauthCredential,
      block.subBlocks.credential?.value,
      block.subBlocks.manualCredential?.value
    )
    const botMode = resolveLegacyMode(
      canonicalModes.botCredential,
      block.subBlocks.customBotCredential?.value,
      block.subBlocks.manualCustomBotCredential?.value
    )
    const activeMode = authMethod === 'bot_token' ? botMode : oauthMode
    const activeValue =
      authMethod === 'bot_token'
        ? activeMode === 'advanced'
          ? block.subBlocks.manualCustomBotCredential?.value
          : block.subBlocks.customBotCredential?.value
        : activeMode === 'advanced'
          ? block.subBlocks.manualCredential?.value
          : block.subBlocks.credential?.value
    const credentialValue = isNonEmptyValue(activeValue) ? (activeValue ?? null) : null
    const currentSubBlocks = omit(block.subBlocks, [
      'authMethod',
      'customBotCredential',
      'manualCustomBotCredential',
    ])

    projectedBlocks ??= { ...blocks }
    projectedBlocks[blockId] = {
      ...block,
      subBlocks: {
        ...currentSubBlocks,
        credential: withValue(
          block.subBlocks.credential,
          'credential',
          'oauth-input',
          activeMode === 'basic' ? credentialValue : null
        ),
        manualCredential: withValue(
          block.subBlocks.manualCredential,
          'manualCredential',
          'short-input',
          activeMode === 'advanced' ? credentialValue : null
        ),
      },
      data: {
        ...block.data,
        canonicalModes: {
          ...canonicalModes,
          oauthCredential: activeMode,
          botCredential: 'basic',
        },
      },
    }
  }

  return projectedBlocks ?? blocks
}
