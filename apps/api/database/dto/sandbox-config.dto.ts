import { Type, type Static } from "@sinclair/typebox";

export const SandboxConfigSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    allowed_modules: Type.Array(Type.String()),
    allowed_functions: Type.Array(Type.String()),
    timeout_seconds: Type.Number(),
    memory_limit_mb: Type.Number(),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.String(),
    metadata: Type.Optional(Type.Any())
});

export const SandboxConfigCreateSchema = Type.Object({
    name: Type.String(),
    description: Type.Optional(Type.String()),
    allowed_modules: Type.Array(Type.String()),
    allowed_functions: Type.Array(Type.String()),
    timeout_seconds: Type.Number(),
    memory_limit_mb: Type.Number(),
    metadata: Type.Optional(Type.Any())
});

export const SandboxConfigUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    allowed_modules: Type.Optional(Type.Array(Type.String())),
    allowed_functions: Type.Optional(Type.Array(Type.String())),
    timeout_seconds: Type.Optional(Type.Number()),
    memory_limit_mb: Type.Optional(Type.Number()),
    metadata: Type.Optional(Type.Any())
});

export type SandboxConfig = Static<typeof SandboxConfigSchema>;
export type SandboxConfigCreateType = Static<typeof SandboxConfigCreateSchema>;
export type SandboxConfigUpdateType = Static<typeof SandboxConfigUpdateSchema>;