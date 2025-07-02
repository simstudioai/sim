import { PrismaClient } from "./generated/prisma/client";

// Ensure a DATABASE_URL variable is set
if (!Bun.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
}

export const client = new PrismaClient();