import { Type, type Static } from "@sinclair/typebox";

export const ToolSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    source: Type.String(),
    metadata: Type.Optional(Type.Any()),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.String()
});

export const ToolCreateSchema = Type.Object({
    name: Type.String(),
    description: Type.Optional(Type.String()),
    source: Type.String(),
    metadata: Type.Optional(Type.Any())
});

export const ToolUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const ToolRunFromSourceSchema = Type.Object({
    source: Type.String(),
    args: Type.Any()
});

export const ToolReturnMessageSchema = Type.Object({
    message: Type.String(),
    data: Type.Optional(Type.Any())
});

export type Tool = Static<typeof ToolSchema>;
export type ToolCreateType = Static<typeof ToolCreateSchema>;
export type ToolUpdateType = Static<typeof ToolUpdateSchema>;
export type ToolRunFromSource = Static<typeof ToolRunFromSourceSchema>;
export type ToolReturnMessage = Static<typeof ToolReturnMessageSchema>;