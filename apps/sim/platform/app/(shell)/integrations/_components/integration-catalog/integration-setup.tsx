'use client'

import { useId, useState } from 'react'
import { ConnectionFields } from '@/platform/app/(shell)/integrations/_components/connection-fields/connection-fields'
import styles from '@/platform/app/(shell)/integrations/_components/integration-catalog/integration-catalog.module.css'
import { FieldFrame, Modal, Select } from '@/platform/design-system/components'
import {
  ACCOUNT_METHOD_LABELS,
  type AccountMethod,
  type IntegrationDraft,
  type IntegrationProvider,
  memberSearchMethod,
  type SearchMode,
} from '@/platform/lib/integrations/model'

const SEARCH_LABELS: Record<SearchMode, string> = {
  member: 'Member accounts',
  service_account: 'Organization service account',
}
const OPTIONAL = { value: 'off', label: 'Off' }

interface IntegrationSetupProps {
  provider: IntegrationProvider
  onCancel: () => void
  onAdd: (draft: IntegrationDraft) => void
}

export function IntegrationSetup({ provider, onAdd, onCancel }: IntegrationSetupProps) {
  const [searchMode, setSearchMode] = useState<SearchMode | null>(provider.searchModes[0] ?? null)
  const [selectedMethod, setAccountMethod] = useState<AccountMethod | null>(
    provider.searchModes.length ? null : (provider.accountMethods[0] ?? null)
  )
  const fieldId = useId()
  const supportsBoth = provider.searchModes.length > 0 && provider.accountMethods.length > 0
  const signIn = searchMode === 'member' ? memberSearchMethod(provider) : undefined
  const methods = provider.accountMethods.filter((method) => method !== signIn)
  const accountMethod = selectedMethod === signIn ? null : selectedMethod
  const accountLabel = signIn ? 'Additional account connection' : 'Account connection'
  const hasEnrollment = accountMethod === 'oauth' || accountMethod === 'slack'
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={`Add ${provider.name}`}
      description={provider.description}
      confirmLabel='Add integration'
      confirmDisabled={!searchMode && !accountMethod}
      onConfirm={(values) => {
        const label = String(values.get('label') ?? provider.name).trim()
        onAdd({
          providerId: provider.id,
          label,
          required: hasEnrollment && values.get('enrollment') === 'required',
          searchMode,
          accountMethod,
          ...(accountMethod === 'databricks' && {
            endpoint: String(values.get('endpoint') ?? '').trim(),
            clientId: String(values.get('clientId') ?? '').trim(),
          }),
        })
      }}
    >
      {(supportsBoth || provider.searchModes.length > 1) && (
        <FieldFrame label='Search access' id={`${fieldId}-search`}>
          <Select
            id={`${fieldId}-search`}
            label='Search access'
            value={searchMode ?? OPTIONAL.value}
            options={[
              ...(supportsBoth ? [OPTIONAL] : []),
              ...provider.searchModes.map((value) => ({ value, label: SEARCH_LABELS[value] })),
            ]}
            onValueChange={(value) =>
              setSearchMode(provider.searchModes.find((mode) => mode === value) ?? null)
            }
          />
        </FieldFrame>
      )}
      {signIn && (
        <p className={styles.hint} data-type='T052'>
          Member search sets up {ACCOUNT_METHOD_LABELS[signIn]} sign-in. Each member connects their
          own account.
        </p>
      )}
      {searchMode === 'service_account' && (
        <p className={styles.hint} data-type='T052'>
          Choose a service source in the integration settings to enable Search.
        </p>
      )}
      {methods.length > 0 && (supportsBoth || methods.length > 1) && (
        <FieldFrame label={accountLabel} id={`${fieldId}-account`}>
          <Select
            id={`${fieldId}-account`}
            label={accountLabel}
            value={accountMethod ?? OPTIONAL.value}
            options={[
              ...(supportsBoth
                ? [{ value: OPTIONAL.value, label: signIn ? 'None' : OPTIONAL.label }]
                : []),
              ...methods.map((value) => ({
                value,
                label: ACCOUNT_METHOD_LABELS[value],
              })),
            ]}
            onValueChange={(value) =>
              setAccountMethod(methods.find((method) => method === value) ?? null)
            }
          />
        </FieldFrame>
      )}
      {accountMethod && <ConnectionFields method={accountMethod} label={provider.name} />}
    </Modal>
  )
}
