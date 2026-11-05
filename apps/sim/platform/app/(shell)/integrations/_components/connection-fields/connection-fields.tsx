import { SelectField, TextField } from '@/platform/design-system/components'
import type { AccountMethod } from '@/platform/lib/integrations/model'

const SUBDOMAIN = '(?:[\\w\\-]+\\.)+'
const WORKSPACE_HOST = `${SUBDOMAIN}(?:databricks\\.com|cloud\\.databricks\\.(?:us|mil)|azuredatabricks\\.net)`
const APP_HOST = `${SUBDOMAIN}databricksapps\\.(?:com|us|mil)`
const PORT = '(?::[0-9]+)?'
const DATABRICKS_ENDPOINT = `https://(?:${WORKSPACE_HOST}${PORT}/(?:api/2\\.0/mcp/|ai-gateway/mcp-services/)[^?#\\s]*|${APP_HOST}${PORT}/mcp/?)`

interface ConnectionFieldsProps {
  method: AccountMethod
  label: string
  required?: boolean
  endpoint?: string
  clientId?: string
}

export function ConnectionFields({
  method,
  label,
  required,
  endpoint,
  clientId,
}: ConnectionFieldsProps) {
  if (method === 'mcp') return null
  const databricks = method === 'databricks'
  return (
    <>
      <TextField
        name='label'
        label='Connection name'
        defaultValue={label}
        required
        pattern={databricks ? '(?=.*\\S).{1,256}' : '(?=.*\\S).{1,100}'}
      />
      {databricks ? (
        <>
          <TextField
            label='MCP endpoint URL'
            name='endpoint'
            defaultValue={endpoint}
            placeholder='https://…/api/2.0/mcp/…'
            required
            pattern={DATABRICKS_ENDPOINT}
          />
          <TextField
            label='OAuth client ID'
            name='clientId'
            defaultValue={clientId}
            required
            pattern={'.*\\S.*'}
          />
        </>
      ) : (
        <SelectField
          name='enrollment'
          label='Member enrollment'
          defaultValue={required ? 'required' : 'optional'}
          options={[
            { value: 'optional', label: 'Optional' },
            { value: 'required', label: 'Required' },
          ]}
        />
      )}
    </>
  )
}
