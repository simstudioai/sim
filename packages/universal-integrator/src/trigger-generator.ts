/**
 * Trigger file generator for Sim.ai integrations.
 *
 * Produces TriggerConfig TypeScript files matching the
 * `apps/sim/triggers/{service}/webhook.ts` pattern.
 *
 * Key SPEC requirements:
 * - Outputs must match formatInput keys EXACTLY
 * - Never guess webhook payloads — if unknown, mark as undocumented
 * - subBlocks use standard TriggerConfig patterns (webhookUrlDisplay, eventTypes, etc.)
 */

export interface TriggerEvent {
  id: string;
  label: string;
}

export interface TriggerOutputField {
  name: string;
  type: string;
  description: string;
}

export interface TriggerGenOptions {
  serviceName: string;
  serviceSlug: string;
  displayName: string;
  description: string;
  events: TriggerEvent[];
  outputFields: TriggerOutputField[];
  hasSignatureVerification: boolean;
  signatureHeader?: string;
  setupInstructions: string[];
}

/**
 * Generate a complete TriggerConfig TypeScript file.
 */
export function generateTriggerFile(options: TriggerGenOptions): string {
  const {
    serviceName,
    serviceSlug,
    displayName,
    description,
    events,
    outputFields,
    hasSignatureVerification,
    setupInstructions,
  } = options;

  const pascalName = toPascalCase(serviceName);

  const eventOptions = events
    .map((e) => `        { label: '${escapeString(e.label)}', id: '${e.id}' },`)
    .join("\n");

  const outputs = outputFields
    .map((o) => {
      const type = mapTriggerOutputType(o.type);
      return [
        `    ${o.name}: {`,
        `      type: '${type}',`,
        `      description: '${escapeString(o.description)}',`,
        `    },`,
      ].join("\n");
    })
    .join("\n");

  const setupHtml = setupInstructions
    .map(
      (instruction, index) =>
        `'<div class="mb-3"><strong>${index + 1}.</strong> ${escapeString(instruction)}</div>',`,
    )
    .join("\n");

  const secretSubBlock = hasSignatureVerification
    ? `    {
      id: 'webhookSecret',
      title: 'Webhook Signing Secret',
      type: 'short-input',
      placeholder: 'Your webhook secret',
      description: 'Used to verify webhook authenticity.',
      password: true,
      mode: 'trigger',
    },`
    : "";

  return `import type { TriggerConfig } from '@/triggers/types'

export const ${serviceSlug}WebhookTrigger: TriggerConfig = {
  id: '${serviceSlug}_webhook',
  name: '${escapeString(displayName)} Webhook',
  provider: '${serviceSlug}',
  description: '${escapeString(description)}',
  version: '1.0.0',

  subBlocks: [
    {
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: 'Webhook URL will be generated',
      mode: 'trigger',
    },
    {
      id: 'eventTypes',
      title: 'Event Types',
      type: 'dropdown',
      multiSelect: true,
      options: [
${eventOptions}
      ],
      placeholder: 'Select events to listen for',
      description: 'Choose which events trigger this webhook.',
      mode: 'trigger',
    },
${secretSubBlock}
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
${setupHtml}
      ].join(''),
      mode: 'trigger',
    },
  ],

  outputs: {
${outputs}
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
`;
}

/**
 * Generate the index.ts barrel export for a service's triggers directory.
 */
export function generateTriggerIndex(triggerName: string): string {
  return `export { ${triggerName} } from './webhook'\n`;
}

// --- Helpers ---

function toPascalCase(str?: string): string {
  if (!str) return "Unknown";
  return str
    .split(/[_\s-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function escapeString(s?: string): string {
  if (!s) return "";
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

function mapTriggerOutputType(type?: string): string {
  if (!type) return "string";
  const t = type.toLowerCase();
  if (t === "integer" || t === "int" || t === "float" || t === "double") return "number";
  if (t === "bool") return "boolean";
  if (t === "object" || t === "dict" || t === "map") return "json";
  return "string";
}
