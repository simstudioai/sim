'use client'

import { useState } from 'react'
import {
  Checkbox,
  ChipDropdown,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
} from '@sim/emcn'
import type { OrganizationAccountWorkspaceAccess } from '@/lib/api/contracts/organization-accounts'
import type { ProjectApi } from '@/lib/api/contracts/projects'
import { isOrganizationCredentialType } from '@/lib/credential-groups/credential-types'

type Grant = OrganizationAccountWorkspaceAccess['grants'][number]
const ALL_INTEGRATIONS = 'all'

interface OrganizationWorkspaceGrantModalBaseProps {
  credentialTypes: OrganizationAccountWorkspaceAccess['credentialTypes']
  disabled: boolean
  error?: string
  onSave: (
    grants: Grant[],
    projectGrants: NonNullable<OrganizationAccountWorkspaceAccess['projectGrants']>
  ) => void
  onClose: () => void
}

interface CreateOrganizationWorkspaceGrantModalProps
  extends OrganizationWorkspaceGrantModalBaseProps {
  mode: 'create'
  projects: ProjectApi[]
}

interface EditOrganizationWorkspaceGrantModalProps
  extends OrganizationWorkspaceGrantModalBaseProps {
  mode: 'edit'
  grant: Grant
  workspaceName: string
  onRemove: () => void
}

interface EditOrganizationProjectGrantModalProps extends OrganizationWorkspaceGrantModalBaseProps {
  mode: 'edit-project'
  project: ProjectApi
  grant: NonNullable<OrganizationAccountWorkspaceAccess['projectGrants']>[number]
  onRemove: () => void
}

type OrganizationWorkspaceGrantModalProps =
  | CreateOrganizationWorkspaceGrantModalProps
  | EditOrganizationWorkspaceGrantModalProps
  | EditOrganizationProjectGrantModalProps

/** All integrations is an explicit grant; an empty picker selection never grants access. */
export function OrganizationWorkspaceGrantModal(props: OrganizationWorkspaceGrantModalProps) {
  const { credentialTypes, disabled, error, onSave, onClose } = props
  const [projectId, setProjectId] = useState(props.mode === 'edit-project' ? props.project.id : '')
  const [allEnvironments, setAllEnvironments] = useState(true)
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([])
  const selectedProject =
    props.mode === 'create'
      ? props.projects.find((project) => project.id === projectId)
      : props.mode === 'edit-project'
        ? props.project
        : undefined
  const [access, setAccess] = useState<Grant['access']>(
    props.mode !== 'create' ? props.grant.access : { mode: 'selected', credentialTypes: [] }
  )
  const title =
    props.mode === 'create'
      ? 'Add project'
      : props.mode === 'edit-project'
        ? `Edit ${props.project.name} access`
        : `Edit ${props.workspaceName} access`
  const save = () => {
    if (access.mode === 'selected' && !access.credentialTypes.length) return
    if (props.mode === 'edit') {
      onSave([{ workspaceId: props.grant.workspaceId, access }], [])
      return
    }
    if (!selectedProject) return
    if (allEnvironments) onSave([], [{ projectId: selectedProject.id, access }])
    else
      onSave(
        workspaceIds
          .filter((id) => selectedProject.workspaces.some((environment) => environment.id === id))
          .map((workspaceId) => ({ workspaceId, access })),
        []
      )
  }

  return (
    <ChipModal
      open
      size='sm'
      srTitle={title}
      dismissDisabled={disabled}
      onOpenChange={(open) => !open && !disabled && onClose()}
    >
      <ChipModalHeader onClose={onClose} closeDisabled={disabled}>
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        {props.mode === 'create' && (
          <ChipModalField type='custom' title='Project' required submitOnEnter={false}>
            {(aria) => (
              <ChipSelect
                options={props.projects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
                value={projectId}
                onChange={(id) => {
                  setProjectId(id)
                  setAllEnvironments(true)
                  setWorkspaceIds([])
                }}
                placeholder='Select project'
                aria-label='Project'
                searchable
                searchPlaceholder='Search projects'
                disabled={disabled}
                fullWidth
                dropdownWidth='trigger'
                align='start'
                {...aria}
              />
            )}
          </ChipModalField>
        )}
        {selectedProject && (
          <ChipModalField type='custom' title='Environments' required submitOnEnter={false}>
            <div className='flex flex-col gap-2'>
              <label
                htmlFor='credential-project-all-environments'
                className='flex items-center gap-2 text-small'
              >
                <Checkbox
                  id='credential-project-all-environments'
                  checked={allEnvironments}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    setAllEnvironments(checked === true)
                    setWorkspaceIds(
                      checked === true
                        ? []
                        : selectedProject.workspaces.map((environment) => environment.id)
                    )
                  }}
                />
                All current and future environments
              </label>
              {selectedProject.workspaces.map((environment) => (
                <label
                  key={environment.id}
                  htmlFor={`credential-environment-${environment.id}`}
                  className='flex items-center gap-2 pl-4 text-small'
                >
                  <Checkbox
                    id={`credential-environment-${environment.id}`}
                    checked={allEnvironments || workspaceIds.includes(environment.id)}
                    disabled={disabled}
                    onCheckedChange={(checked) => {
                      const selected = new Set(
                        allEnvironments
                          ? selectedProject.workspaces.map((item) => item.id)
                          : workspaceIds
                      )
                      if (checked === true) selected.add(environment.id)
                      else selected.delete(environment.id)
                      setAllEnvironments(false)
                      setWorkspaceIds([...selected])
                    }}
                  />
                  {environment.name}
                </label>
              ))}
            </div>
          </ChipModalField>
        )}
        <ChipModalField
          type='custom'
          title='Integrations'
          required
          submitOnEnter={false}
          hint={access.mode === 'all' ? 'Includes integrations added in the future.' : undefined}
        >
          {(aria) => (
            <ChipDropdown
              multiple
              options={[
                { value: ALL_INTEGRATIONS, label: 'All integrations' },
                ...credentialTypes.map((type) => ({ value: type.id, label: type.label })),
              ]}
              value={access.mode === 'all' ? [ALL_INTEGRATIONS] : access.credentialTypes}
              onChange={(values) => {
                if (access.mode !== 'all' && values.includes(ALL_INTEGRATIONS)) {
                  setAccess({ mode: 'all' })
                  return
                }
                const selected = values.filter((value) => value !== ALL_INTEGRATIONS)
                if (!selected.every(isOrganizationCredentialType))
                  throw new Error('Unknown credential type')
                setAccess({ mode: 'selected', credentialTypes: selected })
              }}
              allLabel='Select integrations'
              aria-label='Integrations'
              showAllOption={false}
              searchable
              searchPlaceholder='Search integrations'
              disabled={disabled}
              fullWidth
              matchTriggerWidth
              align='start'
              {...aria}
            />
          )}
        </ChipModalField>
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        cancelDisabled={disabled}
        primaryAction={{
          label: props.mode === 'create' ? 'Add project' : 'Save access',
          disabled:
            disabled ||
            (props.mode !== 'edit' &&
              (!selectedProject || (!allEnvironments && !workspaceIds.length))) ||
            (access.mode === 'selected' && !access.credentialTypes.length),
          onClick: save,
        }}
        secondaryActions={
          props.mode !== 'create'
            ? [
                {
                  label: 'Remove access',
                  variant: 'destructive',
                  disabled,
                  onClick: props.onRemove,
                },
              ]
            : undefined
        }
      />
    </ChipModal>
  )
}
