import { Elysia, ValidationError } from "elysia";
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger'
import { exception, ExceptionCodes, ExceptionType } from "./exceptions";
import config from "./config";
import healthController from "./health/health.controller";
import chatController from "./chat/chat.controller";

Bun.env.PORT = Bun.env.PORT || "8001";
Bun.env.HOST = Bun.env.HOST || "0.0.0.0";

export const handleError = ({ error, set }) => {
  if (error instanceof ValidationError) {
    error = exception(ExceptionCodes.VALIDATION_ERROR, "Bad Request", { errors: error.all });
  }

  const errorTyped = error as ExceptionType;
  set.status = errorTyped?.status || 500;

  return errorTyped;
}

const app = new Elysia()
  // Error handling
  .onError({ as: 'global' }, ({ error, set }) => handleError({ error, set }))

  // CORS
  .use(cors({
    origin: [
      config().server.frontendUrl,
      config().server.backendUrl
    ]
  }))

  // Controllers
  .get("/", () => "Hello World!")
  .use(healthController)
  .use(chatController)

  // Listen
  .listen({
    hostname: Bun.env.HOST,
    port: Bun.env.PORT
  });

// Swagger
if (!Bun.env.NODE_ENV || Bun.env.NODE_ENV === "development") {
  app.use(swagger({
    documentation: {
      info: {
        title: "simstudio.AI",
        description: "simstudio.AI API Documentation",
        version: "1.0.0",
      },
      tags: [

      ]
    },
    path: "/swagger"
  }))
}

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${Bun.env.PORT} (env: ${Bun.env.NODE_ENV})`,
);

if (!Bun.env.NODE_ENV || Bun.env.NODE_ENV === "development") {
  console.log(
    `- 📚 Swagger is running at http://${app.server?.hostname}:${Bun.env.PORT}/swagger`,
  );
}
