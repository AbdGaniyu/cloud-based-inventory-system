import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need the owner login; the running app can use a least-privilege one (pnpm db:grant-app).
    url: process.env.MIGRATION_DATABASE_URL ?? env("DATABASE_URL"),
  },
});
