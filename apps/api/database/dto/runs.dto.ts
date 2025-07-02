import { Type, type Static } from "@sinclair/typebox";

export const RunStatusEnum = Type.Union([
    Type.Literal("pending"),
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("cancelled")
]);

export const RunSchema = Type.Object({
    id: Type.String(),
    name: Type.Optional(Type.String()),
    status: RunStatusEnum,
    input: Type.Any(),
    output: Type.Optional(Type.Any()),
    error: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.String(),
    agent_id: Type.String(),
    metadata: Type.Optional(Type.Any())
});

export const RunCreateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    input: Type.Any(),
    agent_id: Type.String(),
    metadata: Type.Optional(Type.Any())
});

export const RunUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    status: Type.Optional(RunStatusEnum),
    output: Type.Optional(Type.Any()),
    error: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export type RunStatus = Static<typeof RunStatusEnum>;
export type Run = Static<typeof RunSchema>;
export type RunCreateType = Static<typeof RunCreateSchema>;
export type RunUpdateType = Static<typeof RunUpdateSchema>;