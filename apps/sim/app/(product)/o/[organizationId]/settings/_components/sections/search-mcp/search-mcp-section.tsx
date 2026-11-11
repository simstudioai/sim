'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { CopyField } from '@sim/emcn/field/value-fields'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import {
  FieldStack,
  Muted,
  Preformatted,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import { getBaseUrl } from '@/platform/lib/data/mcp'

const CLIENTS = [
  {
    value: 'claude',
    label: 'Claude',
    hint: 'In Claude web or Desktop, add a custom connector with this URL, then sign in to Sim. On Team or Enterprise, an owner adds the connector first.',
  },
  {
    value: 'codex',
    label: 'Codex',
    hint: 'Run this command and sign in to Sim in the browser. To reconnect, run codex mcp login sim-search.',
  },
  {
    value: 'claude-code',
    label: 'Claude Code',
    hint: 'Run this command, then open /mcp in Claude Code to connect and sign in to Sim.',
  },
  {
    value: 'cursor',
    label: 'Cursor',
    hint: 'Add sim-search to mcpServers in ~/.cursor/mcp.json, then connect Sim Search in Cursor and sign in to Sim.',
  },
  {
    value: 'devin',
    label: 'Devin',
    hint: 'In Devin, open Customize → MCPs and add a custom MCP with this URL. Choose HTTP, OAuth, and Personal access, then select Connect and sign in to Sim.',
  },
  {
    value: 'other',
    label: 'Other',
    hint: 'Add this URL in an app that supports remote MCP with OAuth. Choose Streamable HTTP if asked, then sign in to Sim.',
  },
] as const

interface ConnectionInstructionsProps {
  endpoint: string
  client: (typeof CLIENTS)[number]
}

function ConnectionInstructions({ endpoint, client }: ConnectionInstructionsProps) {
  if (client.value === 'cursor') {
    const configuration = JSON.stringify(
      { mcpServers: { 'sim-search': { url: endpoint } } },
      null,
      2
    )
    return (
      <FieldStack>
        <SettingsRow label='Configuration' description={client.hint}>
          <CopyButton label='Copy configuration' text={configuration} />
        </SettingsRow>
        <Preformatted>{configuration}</Preformatted>
      </FieldStack>
    )
  }
  if (client.value === 'claude-code' || client.value === 'codex') {
    const quotedEndpoint = `'${endpoint.replace(/'/g, "'\\''")}'`
    const prefix =
      client.value === 'codex'
        ? 'codex mcp add sim-search --url'
        : 'claude mcp add --transport http sim-search'
    return (
      <CopyField
        label='Terminal command'
        value={`${prefix} ${quotedEndpoint}`}
        hint={client.hint}
      />
    )
  }
  return <CopyField label='Server URL' value={endpoint} hint={client.hint} />
}

export default function SearchMcpSection({ organization }: SettingsSectionProps) {
  const [client, setClient] = useState<(typeof CLIENTS)[number]>(CLIENTS[0])
  const endpoint = `${getBaseUrl()}/api/mcp/search/organizations/${encodeURIComponent(organization.organization.id)}`
  return (
    <SettingsSection title='Connection'>
      {organization.viewer.canUseSearchMcp ? (
        <>
          <SettingsRow label='App' description='Select the app to connect' field>
            <Select
              label='MCP app'
              value={client.value}
              options={CLIENTS}
              onValueChange={(value) => {
                const selection = CLIENTS.find((item) => item.value === value)
                if (selection) setClient(selection)
              }}
            />
          </SettingsRow>
          <ConnectionInstructions key={client.value} client={client} endpoint={endpoint} />
        </>
      ) : (
        <Muted>
          Your organization’s policy disables Sim Search MCP access. Contact an organization admin
          to enable it.
        </Muted>
      )}
      <SettingsRow label='Setup guide' description='Read the Search MCP documentation'>
        <Button
          size='compact'
          render={
            <a
              aria-label='Search MCP documentation'
              href='https://docs.sim.ai/search/mcp'
              target='_blank'
              rel='noreferrer'
            >
              Docs
            </a>
          }
        >
          Docs
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}
