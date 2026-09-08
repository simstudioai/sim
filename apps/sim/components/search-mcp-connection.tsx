'use client'

import { useState } from 'react'
import {
  Chip,
  ChipDropdown,
  ChipModalField,
  Code,
  chipFieldSurfaceClass,
  useCopyToClipboard,
} from '@sim/emcn'
import { Check, Duplicate } from '@sim/emcn/icons'

const CLIENTS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'other', label: 'Other' },
] as const

type SearchMcpClient = (typeof CLIENTS)[number]['value']

interface SearchMcpConnectionProps {
  endpoint: string
  flush?: boolean
}

/** Shared client setup for organization settings and the workspace Search modal. */
export function SearchMcpConnection({ endpoint, flush = false }: SearchMcpConnectionProps) {
  const [client, setClient] = useState<SearchMcpClient>('claude')
  const quotedEndpoint = `'${endpoint.replace(/'/g, "'\\''")}'`
  const configuration =
    client === 'codex'
      ? `codex mcp add sim-search --url ${quotedEndpoint}`
      : client === 'claude-code'
        ? `claude mcp add --transport http sim-search ${quotedEndpoint}`
        : JSON.stringify({ mcpServers: { 'sim-search': { url: endpoint } } }, null, 2)

  return (
    <>
      <ChipModalField type='custom' title='App' flush={flush}>
        <ChipDropdown
          value={client}
          onChange={(value) => {
            const option = CLIENTS.find((item) => item.value === value)
            if (option) setClient(option.value)
          }}
          options={CLIENTS}
          aria-label={`MCP app: ${CLIENTS.find((option) => option.value === client)?.label}`}
          align='start'
          matchTriggerWidth={false}
          className='self-start'
        />
      </ChipModalField>
      {client !== 'cursor' ? (
        <ChipModalField
          key={`${client}:${endpoint}`}
          type='copy'
          title={client === 'codex' || client === 'claude-code' ? 'Terminal command' : 'Server URL'}
          value={client === 'codex' || client === 'claude-code' ? configuration : endpoint}
          copyLabel={
            client === 'codex' || client === 'claude-code' ? 'Copy command' : 'Copy MCP server URL'
          }
          flush={flush}
          hint={
            client === 'claude'
              ? 'In Claude web or Desktop, add a custom connector with this URL, then sign in to Sim. On Team or Enterprise, an owner adds the connector first.'
              : client === 'other'
                ? 'Add this URL in an app that supports remote MCP with OAuth. Choose Streamable HTTP if asked, then sign in to Sim.'
                : client === 'claude-code'
                  ? 'Run this command, then open /mcp in Claude Code to connect and sign in to Sim.'
                  : 'Run this command and sign in to Sim in the browser. To reconnect, run codex mcp login sim-search.'
          }
        />
      ) : (
        <ChipModalField
          type='custom'
          title='Configuration'
          flush={flush}
          hint='Add sim-search to mcpServers in ~/.cursor/mcp.json, then connect Sim Search in Cursor and sign in to Sim.'
        >
          {(aria) => (
            <>
              <Code.Viewer
                code={configuration}
                language='json'
                density='compact'
                wrapText
                className={chipFieldSurfaceClass}
              />
              <CopyConfiguration
                key={`${client}:${endpoint}`}
                code={configuration}
                label='Copy configuration'
                descriptionId={aria['aria-describedby']}
              />
            </>
          )}
        </ChipModalField>
      )}
    </>
  )
}

interface CopyConfigurationProps {
  code: string
  label: string
  descriptionId?: string
}

function CopyConfiguration({ code, label, descriptionId }: CopyConfigurationProps) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <Chip
      className='self-start'
      leftIcon={copied ? Check : Duplicate}
      onClick={() => void copy(code)}
      aria-describedby={descriptionId}
    >
      {label}
    </Chip>
  )
}
