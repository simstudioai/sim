import { EnrichmentIcon } from '@/components/icons'
import type { BlockConfig, OutputFieldDefinition, ParamType } from '@/blocks/types'
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
  tags: ['enrichment'],
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
