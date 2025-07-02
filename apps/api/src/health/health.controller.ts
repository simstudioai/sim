import { Elysia } from 'elysia';
import { Value } from '@sinclair/typebox/value';
import { HealthCheckSchema } from '@simstudio.com/api-agent-management/dto/health.dto';

export default new Elysia({ prefix: '/health', tags: ['health'] })
    .get("", async () => {
        // Read the package version of the backend
        const version = require('../../package.json').version;

        return Value.Parse(HealthCheckSchema, {
            status: 'ok',
            version
        });
    }, {
        response: HealthCheckSchema,
        detail: {
            summary: 'Get basic health status',
            description: 'Returns the basic health status of the application'
        }
    });

