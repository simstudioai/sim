'use client'

import { useId, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { FieldFrame, TextAreaField } from '@sim/emcn/field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { useQueryState } from 'nuqs'
import {
  AddPeopleModal,
  CredentialMembers,
} from '@/app/(product)/_components/credential-members/credential-members'
import { SecretValueInput } from '@/app/(product)/_components/secrets-editor/secret-value-input'
import { SettingsSaveBar } from '@/app/(product)/_components/settings-parts/save-bar'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import {
  SECRET_VIEW_PARAM,
  secretUsageTabParam,
  secretUsageTabUrlKeys,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/search-params'
import { SecretReferences } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-references'
import { SecretUsage } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-usage'
import {
  isApiClientError,
  useCredentialDetailForm,
  useSecretValue,
  useWorkspaceCredential,
} from '@/platform/lib/data/secrets'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import { useSettingsSubview } from '@/platform/lib/data/settings-subview'

/** Logs leads: it is the default tab, and what "See usage" opened before References existed. */
const USAGE_TABS = ['logs', 'references'] as const

/** The `secret-view` value that opens the usage view. */
const USAGE_VIEW = 'usage'

interface SecretDetailProps {
  workspaceId: string
  credentialId: string
  /** Back to the secrets list. */
  onBack: () => void
}

/**
 * One secret: its key, value, description and log visibility, its members, and a usage view with
 * the runs that resolved it and the places that reference it.
 */
export function SecretDetail({ workspaceId, credentialId, onBack }: SecretDetailProps) {
  const valueId = useId()
  const {
    data: credential = null,
    isPending,
    error,
    isFetching,
    refetch,
  } = useWorkspaceCredential(credentialId)
  const isAdmin = credential?.role === 'admin'
  const isPersonal = credential?.type === 'env_personal'

  const [sharing, setSharing] = useState(false)
  const view = useSettingsSubview({ idParam: SECRET_VIEW_PARAM })
  const [usageTab, setUsageTab] = useQueryState(secretUsageTabParam.key, {
    ...secretUsageTabParam.parser,
    ...secretUsageTabUrlKeys,
  })

  const valueField = useSecretValue({ workspaceId, credential })

  /**
   * Description is workspace-only: an `env_personal` credential mirrors one user-global secret per
   * workspace, so a description here would exist in this workspace alone, with no teammates to read it.
   */
  const isWorkspaceSecretAdmin = isAdmin && !isPersonal

  const form = useCredentialDetailForm({
    credential,
    isAdmin: isWorkspaceSecretAdmin,
    section: valueField,
  })
  const back = () => requestSettingsLeave(onBack)

  if (isPending && !credential) return null

  /** A failed load is not a missing secret: permission and reachability failures say so. */
  if (error && !(isApiClientError(error) && error.status === 404))
    return (
      <SectionStack>
        <DetailHeader backLabel='Secrets' onBack={back} title='Secret' />
        <FailureNotice
          message={
            isApiClientError(error) && error.status === 403
              ? 'You don’t have access to this secret'
              : 'Couldn’t load this secret'
          }
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      </SectionStack>
    )

  if (!credential)
    return (
      <SectionStack>
        <DetailHeader backLabel='Secrets' onBack={back} title='Secret' />
        <EmptyState title='Secret not found' />
      </SectionStack>
    )

  const title = credential.envKey || credential.displayName
  const canEditValue = valueField.canEdit && !valueField.isConflicted
  /**
   * Usage names workflows, people and run ids, the slice value masking withholds, so it takes the
   * predicate that reveals the value: admin of a workspace secret, owner of a personal one. A
   * shadowed personal secret is read-only but still its owner's to audit.
   */
  const canViewUsage = valueField.canEdit

  if (canViewUsage && view.id === USAGE_VIEW) {
    const secretName = credential.envKey || ''
    return (
      <SectionStack>
        <DetailHeader
          backLabel={title}
          onBack={() => {
            void setUsageTab(null, { history: 'replace' })
            view.close()
          }}
          title='Usage'
        />
        <ContentTabs
          label='Secret usage views'
          current={usageTab}
          onSelect={(id) => {
            const tab = USAGE_TABS.find((candidate) => candidate === id)
            if (tab) void setUsageTab(tab)
          }}
          items={[
            {
              id: 'logs',
              label: 'Logs',
              content: (
                <SecretUsage
                  workspaceId={workspaceId}
                  secretName={secretName}
                  scope={isPersonal ? 'personal' : 'workspace'}
                />
              ),
            },
            {
              id: 'references',
              label: 'References',
              content: (
                <SecretReferences
                  workspaceId={workspaceId}
                  secretName={secretName}
                  shadowed={valueField.isConflicted}
                />
              ),
            },
          ]}
        />
      </SectionStack>
    )
  }

  return (
    <SectionStack>
      <DetailHeader
        backLabel='Secrets'
        onBack={back}
        title={title}
        description={
          isPersonal
            ? valueField.isConflicted
              ? 'Overridden by a workspace variable'
              : 'Personal secret'
            : 'Workspace secret'
        }
      >
        <Button
          size='compact'
          disabled={!canViewUsage}
          disabledReason={
            isPersonal
              ? 'Only the owner of this secret can see its usage'
              : 'Only admins of this secret can see its usage'
          }
          onClick={() => view.open(USAGE_VIEW)}
        >
          See usage
        </Button>
        {isWorkspaceSecretAdmin && (
          <Button size='compact' onClick={() => setSharing(true)}>
            Share
          </Button>
        )}
      </DetailHeader>
      <SettingsSection title='Details'>
        <FieldStack>
          <FieldFrame id={valueId} label='Value'>
            <SecretValueInput
              id={valueId}
              label='Value'
              value={valueField.value}
              onChange={valueField.setValue}
              canEdit={valueField.canEdit}
              canReveal={!isPersonal && credential.unredacted}
              unmasked={valueField.isConflicted}
              readOnly={valueField.isConflicted}
              placeholder='Enter value'
            />
          </FieldFrame>
          {!isPersonal && (
            <TextAreaField
              label='Description'
              placeholder='Add a description…'
              value={form.descriptionDraft}
              onChange={form.setDescriptionDraft}
              maxLength={500}
              autoComplete='off'
              viewOnly={!isWorkspaceSecretAdmin}
            />
          )}
        </FieldStack>
      </SettingsSection>
      {!isPersonal && (
        <SettingsSection title='Visibility'>
          <SwitchRow
            label='Show value in logs and chat'
            description='Anyone who can see this workspace’s runs sees the value, shared log links included'
            checked={form.unredactedDraft}
            onCheckedChange={form.setUnredactedDraft}
            disabled={!isWorkspaceSecretAdmin}
          />
        </SettingsSection>
      )}
      {(isWorkspaceSecretAdmin || canEditValue) && (
        <SettingsSaveBar
          dirty={form.isDirty}
          saving={form.isSaving}
          onSave={() => void form.save()}
          onDiscard={form.discard}
        />
      )}
      {!isPersonal && (
        <CredentialMembers
          credentialId={credential.id}
          credentialName={credential.displayName}
          isAdmin={isAdmin}
          onLeft={onBack}
        />
      )}
      {!isPersonal && (
        <AddPeopleModal
          workspaceId={workspaceId}
          credentialId={credential.id}
          open={sharing}
          onOpenChange={setSharing}
        />
      )}
    </SectionStack>
  )
}
