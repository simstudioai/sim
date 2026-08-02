'use client'

import { ChipModalField, ChipModalSeparator, ChipSelect } from '@sim/emcn'
import type { SecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import { useRawMountableSecretOptions } from '@/hooks/queries/secret-mount-options'

const SECRET_SCOPE_OPTIONS = [
  { value: 'all', label: 'All secrets' },
  { value: 'selected', label: 'Selected secrets' },
]

interface SecretAccessSectionProps extends SecretMountPolicy {
  workspaceId: string
  onChange: (policy: SecretMountPolicy) => void
}

export function SecretAccessSection({
  workspaceId,
  secretScope,
  mountedSecrets,
  onChange,
}: SecretAccessSectionProps) {
  const { options, isPending } = useRawMountableSecretOptions(workspaceId)

  return (
    <div className='flex flex-col'>
      <ChipModalSeparator />
      <div className='flex flex-col gap-4 px-2 pt-4 pb-4.5'>
        <ChipModalField type='custom' title='Secret access'>
          <ChipSelect
            align='start'
            fullWidth
            dropdownWidth='trigger'
            value={secretScope}
            onChange={(value) =>
              onChange({
                secretScope: value === 'selected' ? 'selected' : 'all',
                mountedSecrets,
              })
            }
            options={SECRET_SCOPE_OPTIONS}
          />
        </ChipModalField>

        {secretScope === 'selected' && (
          <ChipModalField type='custom' title='Secrets'>
            <ChipSelect
              align='start'
              fullWidth
              dropdownWidth='trigger'
              multiSelect
              searchable
              searchPlaceholder='Search secrets'
              placeholder='Select secrets'
              options={options}
              multiSelectValues={mountedSecrets}
              onMultiSelectChange={(values) =>
                onChange({ secretScope: 'selected', mountedSecrets: values })
              }
              disabled={isPending}
            />
          </ChipModalField>
        )}
      </div>
    </div>
  )
}
