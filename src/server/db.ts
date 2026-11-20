import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Which driver talks to PostgreSQL:
 * - `pg` (default): plain TCP on port 5432.
 * - `neon`: Neon's serverless driver over WebSockets on port 443, for hosts whose firewall blocks
 *   outbound 5432 (e.g. Namecheap shared hosting). Only works with a Neon database.
 */
export function databaseDriver(): "pg" | "neon" {
  return process.env.DB_DRIVER === "neon" ? "neon" : "pg";
}

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  if (databaseDriver() === "neon") {
    // Node 22+ has a global WebSocket; the Neon driver needs to be told to use it.
    neonConfig.webSocketConstructor ??= globalThis.WebSocket;
    return new PrismaClient({
      adapter: new PrismaNeon({
        connectionString,
        // Neon suspends an idle compute and its pooler drops idle sockets; a pooled WebSocket kept past
        // that fails the next query with a bare ErrorEvent. Close idle sockets well before then.
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 15_000,
        max: 5,
      }),
    });
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// One client (and connection pool) per process; survive Next.js dev hot reloads.
const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
