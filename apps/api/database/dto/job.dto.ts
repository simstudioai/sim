import { Type, type Static } from "@sinclair/typebox";

export const JobStatusEnum = Type.Union([
    Type.Literal("pending"),
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("cancelled")
]);

export const JobSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    status: JobStatusEnum,
    result: Type.Optional(Type.Any()),
    error: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.String({ format: "date-time" })),
    updated_at: Type.Optional(Type.String({ format: "date-time" })),
    created_by_id: Type.Optional(Type.String()),
    last_updated_by_id: Type.Optional(Type.String()),
    organization_id: Type.String(),
    agent_id: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const JobCreateSchema = Type.Object({
    name: Type.String(),
    description: Type.Optional(Type.String()),
    agent_id: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export const JobUpdateSchema = Type.Object({
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    status: Type.Optional(JobStatusEnum),
    result: Type.Optional(Type.Any()),
    error: Type.Optional(Type.String()),
    metadata: Type.Optional(Type.Any())
});

export type JobStatus = Static<typeof JobStatusEnum>;
export type Job = Static<typeof JobSchema>;
export type JobCreateType = Static<typeof JobCreateSchema>;
export type JobUpdateType = Static<typeof JobUpdateSchema>;