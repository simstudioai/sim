'use client'

import { useId, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { FieldFrame, TextAreaField, TextField } from '@sim/emcn/field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { SaveActions } from '@sim/emcn/settings-section/save-actions'
import { FailureNotice } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { useQueryState } from 'nuqs'
import {
  DetailHeader,
  FieldStack,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  secretDetailViewParam,
  secretDetailViewUrlKeys,
  secretUsageTabParam,
  secretUsageTabUrlKeys,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/search-params'
import {
  AddPeopleModal,
  SecretMembers,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-members'
import { SecretReferences } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-references'
import { SecretUsage } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-usage'
import { SecretValueInput } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/secrets/secret-value-input'
import {
  isApiClientError,
  useCredentialDetailForm,
  useSecretValue,
  useWorkspaceCredential,
} from '@/platform/lib/data/secrets'

/** Logs leads: it is the default tab, and what "See usage" opened before References existed. */
const USAGE_TABS = ['logs', 'references'] as const

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
  const [view, setView] = useQueryState(secretDetailViewParam.key, {
    ...secretDetailViewParam.parser,
    ...secretDetailViewUrlKeys,
  })
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
  const back = () => form.guardBack(onBack)

  if (isPending && !credential) return null

  /** A failed load is not a missing secret: permission and reachability failures say so. */
  if (error && !(isApiClientError(error) && error.status === 404))
    return (
      <SectionStack>
        <DetailHeader backLabel='Secrets' onBack={back} title='Secret' />
        <FailureNotice
          message={
            isApiClientError(error) && error.status === 403
              ? 'You do not have access to this secret.'
              : 'Could not load this secret.'
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
        <EmptyState title='Secret not found.' />
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

  if (canViewUsage && view === 'usage') {
    const secretName = credential.envKey || ''
    return (
      <SectionStack>
        <DetailHeader
          backLabel={title}
          onBack={() => {
            void setView(null, { history: 'replace' })
            void setUsageTab(null, { history: 'replace' })
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
          onClick={() => void setView('usage')}
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
          <TextField label='Key' placeholder='Key' value={credential.envKey || ''} viewOnly />
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
              placeholder='Add a description...'
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
          <SettingsRow
            label='Show value in logs and Chat'
            description='The value is visible to anyone who can see this workspace’s runs — in logs, Chat, and the API, including shared log links.'
          >
            <Switch
              label='Show value in logs and Chat'
              checked={form.unredactedDraft}
              onCheckedChange={form.setUnredactedDraft}
              disabled={!isWorkspaceSecretAdmin}
            />
          </SettingsRow>
        </SettingsSection>
      )}
      {(isWorkspaceSecretAdmin || canEditValue) && (
        <SaveActions
          dirty={form.isDirty}
          saving={form.isSaving}
          onSave={() => void form.save()}
          onDiscard={form.discard}
        />
      )}
      {!isPersonal && (
        <SecretMembers
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
