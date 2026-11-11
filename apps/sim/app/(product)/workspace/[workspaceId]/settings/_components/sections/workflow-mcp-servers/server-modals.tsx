'use client'

import { useState } from 'react'
import { FieldFrame, TextAreaField, TextField } from '@sim/emcn/field'
import { DetailsField } from '@sim/emcn/field/details-field'
import { Modal } from '@sim/emcn/modal'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import {
  useAddWorkflowMcpTool,
  useUpdateWorkflowMcpServer,
  useUpdateWorkflowMcpTool,
  type WorkflowMcpServer,
  type WorkflowMcpTool,
} from '@/platform/lib/data/mcp'

type ParameterProperties = Record<string, { type?: string; description?: string }>

function parameterProperties(tool: WorkflowMcpTool): ParameterProperties {
  return (tool.parameterSchema.properties ?? {}) as ParameterProperties
}

interface EditToolModalProps {
  workspaceId: string
  serverId: string
  tool: WorkflowMcpTool
  onClose: () => void
}

/** A workflow tool's description and its parameters' descriptions, as MCP clients read them. */
export function EditToolModal({ workspaceId, serverId, tool, onClose }: EditToolModalProps) {
  const updateTool = useUpdateWorkflowMcpTool()
  const properties = parameterProperties(tool)
  const [description, setDescription] = useState(tool.toolDescription || '')
  const [parameterDescriptions, setParameterDescriptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(properties).map(([name, property]) => [name, property.description || ''])
    )
  )
  const changed =
    description.trim() !== (tool.toolDescription || '') ||
    Object.entries(properties).some(
      ([name, property]) =>
        (property.description || '') !== (parameterDescriptions[name]?.trim() || '')
    )
  const entries = Object.entries(properties)

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={tool.toolName}
      confirmLabel={updateTool.isPending ? 'Saving…' : 'Save'}
      confirmDisabled={!changed}
      onConfirm={async () => {
        await updateTool.mutateAsync({
          workspaceId,
          serverId,
          toolId: tool.id,
          toolDescription: description.trim(),
          parameterSchema: {
            ...tool.parameterSchema,
            properties: Object.fromEntries(
              entries.map(([name, property]) => [
                name,
                { ...property, description: parameterDescriptions[name]?.trim() || undefined },
              ])
            ),
          },
        })
      }}
    >
      <TextAreaField
        label='Description'
        placeholder='Describe what this tool does…'
        value={description}
        onChange={setDescription}
      />
      {entries.length === 0 ? (
        <DetailsField label='Parameters'>No inputs configured for this workflow.</DetailsField>
      ) : (
        entries.map(([name, property]) => (
          <TextField
            key={name}
            label={`${name} (${property.type || 'any'})`}
            placeholder={`Enter description for ${name}`}
            value={parameterDescriptions[name] || ''}
            onChange={(value) =>
              setParameterDescriptions((previous) => ({ ...previous, [name]: value }))
            }
            autoComplete='off'
          />
        ))
      )}
    </Modal>
  )
}

interface AddWorkflowModalProps {
  workspaceId: string
  serverId: string
  workflows: readonly { value: string; label: string }[]
  onAdded: () => void
  onClose: () => void
}

/** Adds one deployed workflow to the server as a tool. */
export function AddWorkflowModal({
  workspaceId,
  serverId,
  workflows,
  onAdded,
  onClose,
}: AddWorkflowModalProps) {
  const addTool = useAddWorkflowMcpTool()
  const [workflowId, setWorkflowId] = useState<string | null>(null)
  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title='Add workflow'
      description='Select a deployed workflow to add to this MCP server. The workflow will be available as a tool.'
      confirmLabel={addTool.isPending ? 'Adding…' : 'Add workflow'}
      confirmDisabled={!workflowId}
      onConfirm={async () => {
        if (!workflowId) return false
        await addTool.mutateAsync({ workspaceId, serverId, workflowId })
        onAdded()
      }}
    >
      <SearchableSelect
        label='Workflow'
        options={workflows}
        value={workflowId}
        onValueChange={setWorkflowId}
        placeholder='Select a workflow…'
        searchLabel='Search workflows'
      />
    </Modal>
  )
}

interface EditServerModalProps {
  workspaceId: string
  server: WorkflowMcpServer
  /** Only an admin may change who can call the server. */
  canChangeVisibility: boolean
  onClose: () => void
}

/** The server's name, description and access. */
export function EditServerModal({
  workspaceId,
  server,
  canChangeVisibility,
  onClose,
}: EditServerModalProps) {
  const updateServer = useUpdateWorkflowMcpServer()
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description || '')
  const [isPublic, setIsPublic] = useState(server.isPublic)
  const unchanged =
    name === server.name &&
    description === (server.description || '') &&
    isPublic === server.isPublic
  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title='Edit server'
      confirmLabel={updateServer.isPending ? 'Saving…' : 'Save'}
      confirmDisabled={!name.trim() || unchanged}
      onConfirm={async () => {
        await updateServer.mutateAsync({
          workspaceId,
          serverId: server.id,
          name: name.trim(),
          description: description.trim() || undefined,
          isPublic,
        })
      }}
    >
      <TextField
        label='Server name'
        placeholder='e.g., My MCP Server'
        value={name}
        onChange={setName}
        required
        autoComplete='off'
      />
      <TextAreaField
        label='Description'
        placeholder='Describe what this MCP server does'
        value={description}
        onChange={setDescription}
        optional
      />
      <FieldFrame label='Access'>
        <SegmentedControl
          label='Server access'
          options={[
            { value: 'private', label: 'Private', disabled: !canChangeVisibility },
            { value: 'public', label: 'Public (no auth)', disabled: !canChangeVisibility },
          ]}
          value={isPublic ? 'public' : 'private'}
          onSelect={(value) => setIsPublic(value === 'public')}
        />
      </FieldFrame>
    </Modal>
  )
}
