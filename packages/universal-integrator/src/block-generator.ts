/**
 * Block file generator for Sim.ai integrations.
 *
 * Produces a BlockConfig + BlockMeta TypeScript file matching the
 * `apps/sim/blocks/blocks/{service}.ts` pattern.
 *
 * Uses real Sim.ai types: BlockConfig (not "Block"), AuthMode enum,
 * IntegrationType enum, subBlocks with options + value functions.
 */

export type AuthModeStr = "OAuth" | "ApiKey" | "BotToken";

export interface BlockGenOptions {
  serviceName: string;
  serviceSlug: string;
  displayName: string;
  description: string;
  longDescription?: string;
  category: string;
  integrationType: string;
  authMode: AuthModeStr;
  bgColor: string;
  iconName: string;
  tools: string[];
  /** Operation dropdown labels mapped to tool IDs. */
  operations: Array<{ label: string; id: string }>;
  hasTriggers: boolean;
  triggerIds: string[];
  tags: string[];
  templates: Array<{ name: string; prompt: string }>;
  skills: Array<{ title: string; action: string }>;
  authParams: Array<{ id: string; title: string; type: string; required: boolean }>;
  docsLink?: string;
}

/**
 * Generate a complete BlockConfig + BlockMeta TypeScript file.
 */
export function generateBlockFile(options: BlockGenOptions): string {
  const {
    serviceName,
    serviceSlug,
    displayName,
    description,
    longDescription,
    category,
    integrationType,
    authMode,
    bgColor,
    iconName,
    tools,
    operations,
    hasTriggers,
    triggerIds,
    tags,
    templates,
    skills,
    authParams,
    docsLink,
  } = options;

  const pascalName = toPascalCase(serviceName);
  const toolsArray = tools
    .sort()
    .map((t) => `'${t}'`)
    .join(", ");

  // Operation dropdown options
  const operationOptions = operations
    .map((op) => `        { label: '${escapeString(op.label)}', id: '${op.id}' },`)
    .join("\n");

  const defaultOperation = operations[0]?.id ?? tools[0] ?? "";

  // Auth subBlocks using Sim.ai patterns
  const authSubBlocks = authParams
    .map((ap) => {
      const isSecret =
        ap.id.includes("key") ||
        ap.id.includes("secret") ||
        ap.id.includes("token") ||
        ap.id.includes("password");
      return [
        `    {`,
        `      id: '${ap.id}',`,
        `      title: '${ap.title}',`,
        `      type: '${ap.type}',`,
        `      required: ${ap.required},`,
        isSecret ? `      password: true,` : "",
        `      placeholder: 'Enter your ${ap.title.toLowerCase()}',`,
        `    },`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const toolsConfigParams = authParams
    .map((ap) => `        ${ap.id}: (params as any).${ap.id} ?? '',`)
    .join("\n");

  const triggerSection = hasTriggers
    ? `
  triggerAllowed: true,
  triggers: {
    enabled: true,
    available: [${triggerIds.map((t) => `'${t}'`).join(", ")}],
  },`
    : "";

  const tagsArray = tags.map((t) => `'${t}'`).join(", ");
  const templatesArray = templates
    .map((t) => `    { name: '${escapeString(t.name)}', prompt: '${escapeString(t.prompt)}' },`)
    .join("\n");
  const skillsArray = skills
    .map((s) => `    { title: '${escapeString(s.title)}', action: '${s.action}' },`)
    .join("\n");

  const longDescLine = longDescription
    ? `  longDescription: '${escapeString(longDescription)}',\n`
    : "";

  const docsLinkLine = docsLink ? `  docsLink: '${escapeString(docsLink)}',\n` : "";

  const authModeEnum =
    authMode === "OAuth"
      ? "AuthMode.OAuth"
      : authMode === "BotToken"
        ? "AuthMode.BotToken"
        : "AuthMode.ApiKey";
  const integrationTypeEnum = integrationType
    ? `IntegrationType.${integrationType}`
    : `'${integrationType}'`;

  return `import { ${pascalName}Icon } from '@/components/icons-generated/${serviceSlug}'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const ${pascalName}Block: BlockConfig = {
  type: '${serviceSlug}',
  name: '${escapeString(displayName)}',
  description: '${escapeString(description)}',
${longDescLine}${docsLinkLine}  category: '${category}',
  integrationType: ${integrationTypeEnum},
  bgColor: '${bgColor}',
  icon: ${pascalName}Icon,
  authMode: ${authModeEnum},
${triggerSection}
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
${operationOptions}
      ],
      value: () => '${defaultOperation}',
      required: true,
    },
${authSubBlocks}
  ],

  tools: {
    access: [${toolsArray}],
    config: {
      tool: (params: Record<string, any>) => params.operation,
      params: (params: Record<string, any>) => ({
${toolsConfigParams}
      }),
    },
  },

  inputs: {},
  outputs: {},
}

export const ${pascalName}BlockMeta: BlockMeta = {
  displayName: '${escapeString(displayName)}',
  description: '${escapeString(description)}',
  category: '${category}',
  icon: ${pascalName}Icon,
  tags: [${tagsArray}],
  templates: [
${templatesArray}
  ],
  skills: [
${skillsArray}
  ],
}
`;
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
