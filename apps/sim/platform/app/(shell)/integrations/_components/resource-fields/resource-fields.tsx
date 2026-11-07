import { SelectField, TextAreaField, TextField } from '@sim/emcn/field'
import { SecretField } from '@sim/emcn/field/value-fields'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import type { useResourceDraft } from '@/platform/app/(shell)/integrations/_components/resource-fields/use-resource-draft'
import type {
  IntegrationCenterData,
  IntegrationResource,
} from '@/platform/lib/integrations/center-model'

interface ResourceFieldsProps {
  kind: 'skill' | 'mcp'
  editor: ReturnType<typeof useResourceDraft>
}

export function ResourceFields({ kind, editor }: ResourceFieldsProps) {
  const { draft, setDraft, editable } = editor
  return (
    <>
      <TextField
        label='Name'
        placeholder={kind === 'skill' ? 'Skill name' : 'MCP name'}
        name='name'
        value={draft.name}
        onChange={(name) => setDraft({ ...draft, name })}
        viewOnly={!editable}
        required
        maxLength={120}
      />
      <TextAreaField
        label='Description'
        placeholder='Describe what this is for'
        name='description'
        value={draft.description}
        onChange={(description) => setDraft({ ...draft, description })}
        viewOnly={!editable}
        maxLength={500}
      />
      {kind === 'skill' ? (
        <TextAreaField
          label='Instructions'
          placeholder='Describe what this skill should do'
          name='instructions'
          defaultSize='large'
          value={draft.instructions}
          onChange={(instructions) => setDraft({ ...draft, instructions })}
          viewOnly={!editable}
          required
        />
      ) : (
        <>
          <TextField
            label='Server URL'
            name='url'
            type='url'
            value={draft.url}
            onChange={(url) => setDraft({ ...draft, url })}
            placeholder='https://mcp.example.com'
            viewOnly={!editable}
            required
          />
          <SelectField
            label='Authentication'
            name='auth'
            value={draft.auth}
            disabled={!editable}
            disabledReason={
              !editable ? 'Only people with edit access can change authentication.' : undefined
            }
            onValueChange={(auth) => {
              if (auth === 'none' || auth === 'bearer' || auth === 'oauth') {
                editor.setToken('')
                setDraft({ ...draft, auth })
              }
            }}
            options={[
              { value: 'none', label: 'None' },
              { value: 'bearer', label: 'Bearer token' },
              { value: 'oauth', label: 'OAuth' },
            ]}
          />
          {draft.auth === 'bearer' && editable && (
            <SecretField
              label='Token'
              placeholder={
                editor.tokenRequired ? 'Paste a bearer token' : 'Enter a replacement bearer token'
              }
              name='token'
              value={editor.token}
              onChange={editor.setToken}
              optional={!editor.tokenRequired}
              required={editor.tokenRequired}
            />
          )}
        </>
      )}
    </>
  )
}

interface ResourceAccessFieldsProps {
  editor: ReturnType<typeof useResourceDraft>
  data: IntegrationCenterData
  resource?: Exclude<IntegrationResource, { kind: 'credential' }>
}

export function ResourceAccessFields({ editor, data, resource }: ResourceAccessFieldsProps) {
  const { draft, setDraft, editable } = editor
  return (
    <>
      <SelectField
        label='Access'
        value={draft.scope}
        disabled={!editable}
        disabledReason={!editable ? 'Only people with edit access can change sharing.' : undefined}
        onValueChange={(scope) => {
          if (scope === 'shared' || scope === 'personal') setDraft({ ...draft, scope })
        }}
        options={[
          { value: 'personal', label: 'Personal' },
          { value: 'shared', label: 'Shared' },
        ]}
      />
      {draft.scope === 'shared' && editable && (
        <MultiSelect
          label='People with access'
          searchLabel='Find people'
          placeholder='Choose people'
          options={data.people
            .filter((person) => person.id !== (resource?.owner.id ?? data.viewer.id))
            .map((person) => ({ value: person.id, label: person.name }))}
          value={draft.people}
          onValueChange={(people) => setDraft({ ...draft, people })}
        />
      )}
    </>
  )
}
