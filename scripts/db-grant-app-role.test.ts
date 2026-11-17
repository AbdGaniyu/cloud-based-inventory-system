import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_DELETABLE_TABLES, APP_INSERT_ONLY_TABLES } from "./db-grant-app-role";

/** Prisma model name (camelCase, as used on the client) → database table, from the schema's @@map lines. */
function modelTables(): Map<string, string> {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const out = new Map<string, string>();
  for (const block of schema.split(/\nmodel /).slice(1)) {
    const name = block.slice(0, block.indexOf(" "));
    const table = /@@map\("([^"]+)"\)/.exec(block)?.[1] ?? name;
    out.set(name.charAt(0).toLowerCase() + name.slice(1), table);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !entry.includes(".test.") ? [path] : [];
  });
}

describe("least-privilege app role", () => {
  const tables = modelTables();
  const code = [...sourceFiles("src/server"), ...sourceFiles("src/app")].map((f) => [f, readFileSync(f, "utf8")] as const);

  it("may delete from every table the app code deletes from (and from no others)", () => {
    const deleted = new Set<string>();
    for (const [file, text] of code) {
      for (const m of text.matchAll(/\b(?:db|tx)\.(\w+)\.(?:deleteMany|delete)\(/g)) {
        const table = tables.get(m[1]);
        expect(table, `${file}: unknown model ${m[1]}`).toBeDefined();
        deleted.add(table ?? m[1]);
      }
      // Raw SQL: only the tagged templates passed to $queryRaw / $executeRaw (not, say, Tailwind's "truncate").
      for (const sql of text.matchAll(/\$(?:queryRaw|executeRaw)(?:Unsafe)?(?:<[^`]*?>)?`([^`]*)`/g)) {
        expect(/\bDELETE\s+FROM\b|\bTRUNCATE\b/i.test(sql[1]), `${file} deletes in raw SQL; add it to the grant script`).toBe(false);
      }
    }
    expect([...deleted].sort()).toEqual([...APP_DELETABLE_TABLES].sort());
  });

  it("never updates the append-only tables", () => {
    const insertOnly = new Set<string>(APP_INSERT_ONLY_TABLES);
    for (const [file, text] of code) {
      for (const m of text.matchAll(/\b(?:db|tx)\.(\w+)\.(?:update|updateMany|upsert)\(/g)) {
        expect(insertOnly.has(tables.get(m[1]) ?? ""), `${file} updates ${m[1]}`).toBe(false);
      }
    }
  });
});
