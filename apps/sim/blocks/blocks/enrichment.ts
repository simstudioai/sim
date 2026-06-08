import { EnrichmentIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta, OutputFieldDefinition, ParamType } from '@/blocks/types'
import { IntegrationType } from '@/blocks/types'
import { ALL_ENRICHMENTS, getEnrichment } from '@/enrichments'
import { mapFieldType } from '@/enrichments/providers'
import type { EnrichmentOutputField } from '@/enrichments/types'
import type { EnrichmentRunResponse } from '@/tools/enrichment/types'

/** Stable subBlock id for an enrichment input (unique across enrichments). */
const inputFieldId = (enrichmentId: string, inputId: string) => `${enrichmentId}__${inputId}`

// One input field per (enrichment, input), shown only for its enrichment.
const inputSubBlocks = ALL_ENRICHMENTS.flatMap((enrichment) =>
  enrichment.inputs.map((input) => ({
    id: inputFieldId(enrichment.id, input.id),
    title: input.name,
    type: 'short-input' as const,
    placeholder: input.description ?? `Enter ${input.name.toLowerCase()}`,
    condition: { field: 'operation', value: enrichment.id },
    required: input.required ? ({ field: 'operation', value: enrichment.id } as const) : undefined,
  }))
)

// Block input schema: the operation plus every per-enrichment input field.
const blockInputs: Record<string, { type: ParamType; description: string }> = {
  operation: { type: 'string', description: 'Enrichment to run' },
}
for (const enrichment of ALL_ENRICHMENTS) {
  for (const input of enrichment.inputs) {
    blockInputs[inputFieldId(enrichment.id, input.id)] = {
      type: mapFieldType(input.type),
      description: `${input.name} (for ${enrichment.name})`,
    }
  }
}

// Union of all enrichment outputs, each shown only for the enrichment(s) that
// produce it.
const outputProducers = new Map<string, { field: EnrichmentOutputField; operations: string[] }>()
for (const enrichment of ALL_ENRICHMENTS) {
  for (const output of enrichment.outputs) {
    const entry = outputProducers.get(output.id) ?? { field: output, operations: [] }
    entry.operations.push(enrichment.id)
    outputProducers.set(output.id, entry)
  }
}
// Seed the enrichment outputs first so the reserved `matched` / `provider`
// keys (assigned below) always win if a future enrichment ever declares an
// output id that collides with them.
const blockOutputs: Record<string, OutputFieldDefinition> = {}
for (const [id, { field, operations }] of outputProducers) {
  blockOutputs[id] = {
    type: mapFieldType(field.type),
    description: field.name,
    condition: { field: 'operation', value: operations },
  }
}
blockOutputs.matched = {
  type: 'boolean',
  description: 'Whether the enrichment found a result',
}
blockOutputs.provider = {
  type: 'string',
  description: 'Provider whose result was returned (e.g. "Hunter", "People Data Labs")',
}

/**
 * Enrichment block — runs a code-defined Sim enrichment (Work Email, Phone
 * Number, Company Domain, Company Info, …) and returns its outputs. Generated
 * from the enrichment registry, so new enrichments appear automatically. Runs
 * on the workspace's hosted / BYOK key (injected server-side); no credential.
 */
export const EnrichmentBlock: BlockConfig<EnrichmentRunResponse> = {
  type: 'enrichment',
  name: 'Data Enrichment',
  description: 'Enrich data with a Sim enrichment',
  longDescription:
    'Run a Sim enrichment to look up data — work email, phone number, company domain, company info, and more — from the fields you map in. Uses the same provider cascade as table enrichments.',
  docsLink: 'https://docs.sim.ai/tools/enrichment',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#9333EA',
  icon: EnrichmentIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Enrichment',
      type: 'dropdown',
      options: ALL_ENRICHMENTS.map((e) => ({ label: e.name, id: e.id })),
      value: () => ALL_ENRICHMENTS[0]?.id ?? '',
    },
    ...inputSubBlocks,
  ],

  tools: {
    access: ['enrichment_run'],
    config: {
      tool: () => 'enrichment_run',
      params: (params) => {
        const enrichment = getEnrichment(params.operation)
        const inputs: Record<string, unknown> = {}
        if (enrichment) {
          for (const input of enrichment.inputs) {
            const value = params[inputFieldId(enrichment.id, input.id)]
            if (value !== undefined && value !== '') inputs[input.id] = value
          }
        }
        return { enrichmentId: params.operation, inputs }
      },
    },
  },

  inputs: blockInputs,
  outputs: blockOutputs,
}

export const EnrichmentBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  templates: [
    {
      icon: EnrichmentIcon,
      title: 'Work email finder',
      prompt:
        'Build a workflow that reads prospect rows with a full name and company domain from a table, runs the Work Email enrichment to find each verified work email, and writes the result back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Phone number lookup',
      prompt:
        "Create a workflow that takes a contact's full name and company domain, runs the Phone Number enrichment to find their direct phone, and appends the number to a call-list table for the SDR team.",
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Company domain resolver',
      prompt:
        'Build a workflow that reads a list of company names from a table, runs the Company Domain enrichment to resolve each website domain, and writes the matched domains back so later steps can enrich against them.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Company profile enricher',
      prompt:
        'Create a workflow that takes a company domain, runs the Company Info enrichment to pull industry, employee count, founded year, and description, and writes the firmographics into an accounts table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Name to full contact pipeline',
      prompt:
        'Build a workflow that takes a prospect name and company name, first runs the Company Domain enrichment to resolve the domain, then runs Work Email and Phone Number enrichments to find the verified email and phone, and writes a complete contact row to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Inbound lead qualifier',
      prompt:
        'Create a workflow that on a new inbound signup runs the Company Info enrichment on the email domain to pull industry and headcount, scores fit against my ICP with an agent, and routes qualified leads to the sales Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation', 'enrichment'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: EnrichmentIcon,
      title: 'CRM enrichment sweep',
      prompt:
        'Build a scheduled workflow that pulls HubSpot contacts missing a work email or phone, runs the Work Email and Phone Number enrichments to fill the gaps, and updates each record so the database stays ready for outbound.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'enrichment'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: EnrichmentIcon,
      title: 'Target account researcher',
      prompt:
        'Create a workflow that takes a company name, resolves its domain with the Company Domain enrichment, pulls firmographics with Company Info, and compiles an account brief into a file for reps to review before outreach.',
      modules: ['files', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
  ],
} as const satisfies BlockMeta
