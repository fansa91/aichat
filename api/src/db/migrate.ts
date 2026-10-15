// 迁移执行器：按文件名排序依次应用 migrations/*.sql 中未应用的部分。
// 规则：迁移文件只增不改；已应用版本记录在 schema_migrations 表。

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import type { AppConfig } from "../config.js";

const here = dirname(fileURLToPath(import.meta.url));

export function migrationsDir(): string {
  // src/db/migrate.ts -> <api>/migrations
  return join(here, "..", "..", "migrations");
}

function splitStatements(sql: string): string[] {
  // 按行去掉整行注释，再用扫描器按分号切分（跳过字符串字面量内的分号）。
  const noComments = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  const stmts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  const push = () => {
    const t = cur.trim();
    if (t && !/^\s*USE\s/i.test(t)) stmts.push(t.endsWith(";") ? t : t + ";"); // USE 由 changeUser 代替
    cur = "";
  };
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (quote) {
      cur += ch;
      if (ch === "\\" && i + 1 < noComments.length) { cur += noComments[++i]; continue; }
      if (ch === quote) {
        if (noComments[i + 1] === quote) { cur += noComments[++i]; continue; } // '' 转义
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === "`" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === ";") { push(); continue; }
    cur += ch;
  }
  push();
  return stmts;
}

export async function runMigrations(cfg: AppConfig, dir = migrationsDir()): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const conn = await mysql.createConnection({
    host: cfg.db.host,
    port: cfg.db.port,
    user: cfg.db.user,
    password: cfg.db.password,
    multipleStatements: false,
  });
  const applied: string[] = [];
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.changeUser({ database: cfg.db.name });
    await conn.query(
      "CREATE TABLE IF NOT EXISTS `schema_migrations` (`version` VARCHAR(64) NOT NULL, `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (`version`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
    const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT `version` FROM `schema_migrations`");
    const done = new Set(rows.map((r) => r.version as string));

    for (const file of files) {
      // 版本号取文件名前导数字（001_init.sql -> 001），与 SQL 文件内自记录的版本一致
      const version = file.match(/^(\d+)/)?.[1] ?? file.replace(/\.sql$/, "");
      if (done.has(version)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      for (const stmt of splitStatements(sql)) {
        await conn.query(stmt);
      }
      // INSERT IGNORE：SQL 文件末尾可能已自记录版本，此处兜底
      await conn.query("INSERT IGNORE INTO `schema_migrations` (`version`) VALUES (?)", [version]);
      applied.push(version);
    }
  } finally {
    await conn.end();
  }
  return applied;
}
