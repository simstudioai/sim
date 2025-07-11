const frontendUrl = Bun.env.SERVER_URL_FRONTEND || "http://localhost:3000";
const environment = Bun.env.NODE_ENV || "development";
const appHost = Bun.env.SERVER_HOST_BACKEND || "localhost";
const appPort = Bun.env.SERVER_PORT_BACKEND || "8000";
const backendUrl = Bun.env.SERVER_URL_BACKEND || `http://${appHost}:${appPort}`;

export default () => ({
    environment,
    server: {
        backendUrl,
        frontendUrl,
        port: appPort,
        host: appHost,
    },
    database: {
        prisma: {
            url: Bun.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/simstudiocom",
        },
    },
});
