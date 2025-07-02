import { Type, type Static } from "@sinclair/typebox";

export const SystemStatsSchema = Type.Object({
    total_users: Type.Number(),
    total_organizations: Type.Number(),
    total_agents: Type.Number(),
    total_runs: Type.Number(),
    active_users_last_24h: Type.Number(),
    api_calls_last_24h: Type.Number(),
    cpu_usage: Type.Number(),
    memory_usage: Type.Number(),
    disk_usage: Type.Number()
});

export const AdminActionLogSchema = Type.Object({
    id: Type.String(),
    action: Type.String(),
    entity_type: Type.String(),
    entity_id: Type.String(),
    admin_id: Type.String(),
    details: Type.Optional(Type.Any()),
    created_at: Type.String({ format: "date-time" })
});

export const AdminSettingsSchema = Type.Object({
    maintenance_mode: Type.Boolean(),
    allow_new_registrations: Type.Boolean(),
    default_rate_limits: Type.Object({
        requests_per_minute: Type.Number(),
        requests_per_day: Type.Number()
    }),
    system_announcements: Type.Array(Type.Object({
        id: Type.String(),
        title: Type.String(),
        message: Type.String(),
        severity: Type.Union([
            Type.Literal("info"),
            Type.Literal("warning"),
            Type.Literal("critical")
        ]),
        active: Type.Boolean(),
        start_date: Type.String({ format: "date-time" }),
        end_date: Type.Optional(Type.String({ format: "date-time" }))
    }))
});

export type SystemStats = Static<typeof SystemStatsSchema>;
export type AdminActionLog = Static<typeof AdminActionLogSchema>;
export type AdminSettings = Static<typeof AdminSettingsSchema>;