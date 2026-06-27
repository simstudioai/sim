/**
 * Tool file generator for Sim.ai integrations.
 *
 * Takes structured endpoint data from DeepSeek analysis and produces
 * ready-to-write ToolConfig TypeScript files matching the Sim.ai pattern:
 * `apps/sim/tools/{service}/{action}.ts`
 *
 * CRITICAL RULE: Only generates transformResponse when schemaVerified is true.
 * For unverified schemas, outputs are left as a raw data passthrough.
 */

export interface EndpointParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  visibility: "hidden" | "user-only" | "user-or-llm" | "llm-only";
}

export interface EndpointOutput {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
  properties?: EndpointOutput[];
  items?: { type: string; properties?: EndpointOutput[] };
}

export interface EndpointSpec {
  id: string;
  method: string;
  path: string;
  name: string;
  description: string;
  category: string;
  params: EndpointParam[];
  responseFields: EndpointOutput[];
  /**
   * Schema verification level:
   * - true / "documented" → transformResponse can be generated
   * - "example_verified" / "live_verified" → transformResponse can be generated
   * - false / "partial" / "unknown" → NO transformResponse, use raw passthrough
   */
  schemaVerified: boolean | string;
}

export interface GeneratedTool {
  id: string;
  fileName: string;
  code: string;
}

function isSchemaVerified(status?: boolean | string): boolean {
  if (status == null) return false;
  if (typeof status === "boolean") return status;
  const s = String(status).toLowerCase();
  return s === "documented" || s === "example_verified" || s === "live_verified" || s === "true";
}

function validateEndpoint(endpoint: EndpointSpec): string[] {
  const errors: string[] = [];
  if (!endpoint.id) errors.push("Missing id");
  else if (!endpoint.id.match(/^[a-z][a-z0-9_]+$/))
    errors.push(`ID "${endpoint.id}" must be snake_case`);
  if (!endpoint.method) errors.push(`Missing method for ${endpoint.id || "unknown"}`);
  if (!endpoint.path) errors.push(`Missing path for ${endpoint.id || "unknown"}`);
  return errors;
}

export function generateToolFile(
  endpoint: EndpointSpec,
  baseUrl: string,
  authParamName: string,
  authHeaderTemplate: string,
): GeneratedTool {
  const errors = validateEndpoint(endpoint);
  if (errors.length > 0) {
    throw new Error(`Invalid endpoint ${endpoint.id}:\n${errors.join("\n")}`);
  }

  const verified = isSchemaVerified(endpoint.schemaVerified);

  const paramsEntries = (endpoint.params || []).map((p) => {
    const parts: string[] = [];
    parts.push(`    ${p.name}: {`);
    parts.push(`      type: '${mapParamType(p.type)}',`);
    if (p.required) parts.push(`      required: true,`);
    parts.push(`      visibility: '${p.visibility}',`);
    parts.push(`      description: '${escapeString(p.description)}',`);
    parts.push(`    },`);
    return parts.join("\n");
  });

  const outputEntries = (endpoint.responseFields || [])
    .filter((o) => o.name && o.type)
    .map((o) => {
      const lines: string[] = [];
      lines.push(`    ${o.name}: {`);
      lines.push(`      type: '${mapOutputType(o.type)}',`);
      lines.push(`      description: '${escapeString(o.description)}',`);
      if (o.optional) lines.push(`      optional: true,`);
      if (o.properties?.length) {
        lines.push(`      properties: {`);
        o.properties.forEach((sp) => {
          lines.push(
            `        ${sp.name}: { type: '${mapOutputType(sp.type)}', description: '${escapeString(sp.description)}' },`,
          );
        });
        lines.push(`      },`);
      }
      if (o.items) {
        lines.push(`      items: {`);
        lines.push(`        type: '${mapOutputType(o.items.type)}',`);
        if (o.items.properties?.length) {
          lines.push(`        properties: {`);
          o.items.properties.forEach((ip) => {
            lines.push(
              `          ${ip.name}: { type: '${mapOutputType(ip.type)}', description: '${escapeString(ip.description)}' },`,
            );
          });
          lines.push(`        },`);
        }
        lines.push(`      },`);
      }
      lines.push(`    },`);
      return lines.join("\n");
    });

  // CRITICAL: Only generate transformResponse if schema is verified
  let transformSection = "";
  if (verified && (endpoint.responseFields || []).length > 0) {
    const transformFields = (endpoint.responseFields || [])
      .filter((o) => o.name)
      .map((o) => `      ${o.name}: data.${o.name} ?? ${getDefaultForType(o.type)},`)
      .join("\n");

    transformSection = `
  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
${transformFields}
    }
  },`;
  } else if (!verified) {
    transformSection = `
  // ⚠ Schema not verified — returning raw response. Do NOT add guessed fields.
  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { data }
  },`;
  }

  const pathExpr = endpoint.path.includes("{")
    ? endpoint.path.replace(/\{(\w+)\}/g, "${params.$1}")
    : endpoint.path;

  const upperMethod = endpoint.method.toUpperCase();
  const needsBody = upperMethod !== "GET" && upperMethod !== "DELETE" && upperMethod !== "HEAD";

  const bodySection = needsBody
    ? authParamName
      ? `    body: (params) => {
      const { ${authParamName}, ...bodyParams } = params
      return bodyParams
    },`
      : `    body: (params) => params,`
    : "";

  const camelId = toCamelCase(endpoint.id);

  const baseUrlStr = baseUrl || "https://api.REPLACE_ME.com";
  const headersBlock = authHeaderTemplate
    ? `    headers: (params) => ({
      'Authorization': \`${authHeaderTemplate}\`,
      'Content-Type': 'application/json',
    }),`
    : `    headers: () => ({
      'Content-Type': 'application/json',
    }),`;

  const code = `import type { ToolConfig } from '@/tools/types'

export const ${camelId}Tool: ToolConfig = {
  id: '${endpoint.id}',
  name: '${escapeString(endpoint.name)}',
  description: '${escapeString(endpoint.description)}',
  version: '1.0.0',

  params: {
${paramsEntries.join("\n")}
  },

  outputs: {
${outputEntries.join("\n") || "    // ⚠ Output schema not verified — update after API testing"}
  },

  request: {
    url: () => \`${baseUrlStr}${pathExpr}\`,
    method: () => '${upperMethod}',
${headersBlock}
${bodySection}
  },
${transformSection}
}
`;

  return { id: endpoint.id, fileName: `${endpoint.id}.ts`, code };
}

export function generateToolsIndex(tools: GeneratedTool[]): string {
  const imports = tools
    .map((t) => `export { ${toCamelCase(t.id)}Tool } from './${t.id}'`)
    .join("\n");

  return `/**
 * ${tools[0]?.id.split("_")[0] ?? "Service"} integration tools.
 * All tools exported for registry.
 */

${imports}
`;
}

export function generateTypesFile(serviceName: string, hasFileUpload: boolean): string {
  const pascalName = toPascalCase(serviceName);

  let code = `/**
 * ${pascalName} API integration types and shared utilities.
 */

export interface ${pascalName}Credentials {
  apiKey: string
}

export interface ${pascalName}ErrorResponse {
  error: {
    code?: string
    type: string
    message: string
  }
}
`;
  if (hasFileUpload) {
    code += `
export interface ${pascalName}FileUpload {
  file: Buffer
  fileName: string
  mimeType: string
}
`;
  }

  code += `
export function transform${pascalName}Error(response: unknown): string {
  if (response && typeof response === 'object' && 'error' in response) {
    const err = response as ${pascalName}ErrorResponse
    return err.error?.message ?? 'Unknown error'
  }
  return 'Request failed'
}
`;
  return code;
}

// --- Helpers ---

function toCamelCase(snake?: string): string {
  if (!snake) return "unknown";
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

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

function mapParamType(type?: string): string {
  if (!type) return "string";
  const t = type.toLowerCase();
  if (t === "integer" || t === "int" || t === "float" || t === "double") return "number";
  if (t === "bool") return "boolean";
  if (t === "object" || t === "dict" || t === "map") return "json";
  if (t === "file") return "file";
  if (t === "file[]" || t === "files") return "file[]";
  return "string";
}

function mapOutputType(type?: string): string {
  if (!type) return "string";
  const t = type.toLowerCase();
  if (t === "integer" || t === "int" || t === "float" || t === "double") return "number";
  if (t === "bool") return "boolean";
  if (t === "object" || t === "dict" || t === "map") return "json";
  if (t === "array" || t === "list") return "array";
  if (t === "file") return "file";
  if (t === "file[]" || t === "files") return "file[]";
  return "string";
}

function getDefaultForType(type?: string): string {
  if (!type) return "''";
  const t = type.toLowerCase();
  if (t === "number" || t === "integer" || t === "int" || t === "float") return "0";
  if (t === "boolean" || t === "bool") return "false";
  if (t === "array" || t === "list" || t === "object" || t === "json") return "null";
  return "''";
}
