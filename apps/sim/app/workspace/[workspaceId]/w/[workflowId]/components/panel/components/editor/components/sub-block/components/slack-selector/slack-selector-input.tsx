'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
import { getProviderIdFromServiceId } from '@/lib/oauth'
import { SelectorCombobox } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/selector-combobox/selector-combobox'
import { useDependsOnGate } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'

type SlackSelectorType = 'channel-selector' | 'user-selector'

const SELECTOR_CONFIG: Record<
  SlackSelectorType,
  { selectorKey: SelectorKey; placeholder: string; label: string }
> = {
  'channel-selector': {
    selectorKey: 'slack.channels',
    placeholder: 'Select Slack channel',
    label: 'Channel',
  },
  'user-selector': {
    selectorKey: 'slack.users',
    placeholder: 'Select Slack user',
    label: 'User',
  },
}

interface SlackSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onSelect?: (value: string) => void
  isPreview?: boolean
  previewValue?: any | null
  previewContextValues?: Record<string, any>
}

export function SlackSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onSelect,
  isPreview = false,
  previewValue,
  previewContextValues,
}: SlackSelectorInputProps) {
  const selectorType = subBlock.type as SlackSelectorType
  const config = SELECTOR_CONFIG[selectorType]

  const params = useParams()
  const workflowIdFromUrl = (params?.workflowId as string) || ''
  const [storeValue] = useSubBlockValue(blockId, subBlock.id)
  const [authMethod] = useSubBlockValue(blockId, 'authMethod')
  const [botToken] = useSubBlockValue(blockId, 'botToken')
  const [connectedCredential] = useSubBlockValue(blockId, 'credential')

  const effectiveAuthMethod = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.authMethod)
    : authMethod
  const effectiveBotToken = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.botToken)
    : botToken
  const effectiveCredential = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.credential)
    : connectedCredential
  const [_selectedValue, setSelectedValue] = useState<string | null>(null)

  const serviceId = subBlock.serviceId || ''
  const effectiveProviderId = useMemo(() => getProviderIdFromServiceId(serviceId), [serviceId])
  const isSlack = serviceId === 'slack'

  const { finalDisabled, dependsOn } = useDependsOnGate(blockId, subBlock, {
    disabled,
    isPreview,
    previewContextValues,
  })

  const credential: string =
    (effectiveAuthMethod as string) === 'bot_token'
      ? (effectiveBotToken as string) || ''
      : (effectiveCredential as string) || ''

  const { isForeignCredential } = useForeignCredential(
    effectiveProviderId,
    (effectiveAuthMethod as string) === 'bot_token' ? '' : (effectiveCredential as string) || ''
  )

  useEffect(() => {
    const val = isPreview && previewValue !== undefined ? previewValue : storeValue
    if (typeof val === 'string') {
      setSelectedValue(val)
    }
  }, [isPreview, previewValue, storeValue])

  const requiresCredential = dependsOn.includes('credential')
  const missingCredential = !credential || credential.trim().length === 0
  const shouldForceDisable = requiresCredential && (missingCredential || isForeignCredential)

  const context: SelectorContext = useMemo(
    () => ({
      credentialId: credential,
      workflowId: workflowIdFromUrl,
    }),
    [credential, workflowIdFromUrl]
  )

  if (!isSlack) {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className='w-full rounded border p-4 text-center text-muted-foreground text-sm'>
            {config.label} selector not supported for service: {serviceId || 'unknown'}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          <p>
            This {config.label.toLowerCase()} selector is not yet implemented for{' '}
            {serviceId || 'unknown'}
          </p>
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className='w-full'>
          <SelectorCombobox
            blockId={blockId}
            subBlock={subBlock}
            selectorKey={config.selectorKey}
            selectorContext={context}
            disabled={finalDisabled || shouldForceDisable || isForeignCredential}
            isPreview={isPreview}
            previewValue={previewValue ?? null}
            placeholder={subBlock.placeholder || config.placeholder}
            onOptionChange={(value) => {
              setSelectedValue(value)
              if (!isPreview) {
                onSelect?.(value)
              }
            }}
          />
        </div>
      </Tooltip.Trigger>
    </Tooltip.Root>
  )
}
