'use client'

import type { ReactNode } from 'react'
import { FailureNotice } from '@sim/emcn/status'
import { type GuardBack, SecretRows } from '@/app/(product)/_components/secrets-editor/secret-rows'
import { SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { useGenericSecrets } from '@/platform/lib/data/generic-secrets'

export interface GenericSecretsProps {
  organizationId: string
  mode: 'organization' | 'member'
  header?: (guardBack: GuardBack) => ReactNode
}

/** One source's Generic Secrets: the organization's, or the viewer's own. */
export function GenericSecrets({ organizationId, mode, header }: GenericSecretsProps) {
  const { failure, editor } = useGenericSecrets(organizationId, mode)
  const failureNotice = failure && (
    <FailureNotice message={failure.message} retrying={failure.retrying} onRetry={failure.retry} />
  )
  /** A failed refetch keeps the editor mounted with its drafts; only a first load shows failure. */
  if (!editor)
    return (
      <SectionStack>
        {header?.((leave) => leave())}
        {failureNotice}
      </SectionStack>
    )
  return (
    <SecretRows
      key={editor.sourceId}
      header={header}
      refreshFailure={failureNotice}
      isSaving={editor.isSaving}
      scopes={[
        {
          id: mode,
          title: mode === 'organization' ? 'Organization' : 'Personal',
          variables: editor.variables,
          save: ({ upsert, remove }) => editor.save({ upsert, remove }),
        },
      ]}
    />
  )
}
