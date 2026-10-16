import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { setupApp, teardownApp, testConfig } from "./helpers.js";
import { runMigrations } from "../src/db/migrate.js";

let app: FastifyInstance;
test.before(async () => { app = await setupApp(); });
test.after(async () => { await teardownApp(app); });

test("迁移：001+002+003+004 按序应用且幂等", async () => {
  const applied = await runMigrations(testConfig());
  assert.deepEqual(applied, [], "重复执行不应重复应用");
  const [rows] = await app.pool.query<RowDataPacket[]>(
    "SELECT version FROM schema_migrations ORDER BY version"
  );
  assert.deepEqual(rows.map((r) => r.version), ["001", "002", "003", "004"]);
});

test("迁移：表结构完整", async () => {
  const [tables] = await app.pool.query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY n"
  );
  const names = tables.map((t) => t.n);
  for (const t of ["users", "sessions", "model_configs", "api_keys", "conversations", "messages", "schema_migrations"]) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
  const [cols] = await app.pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME IN ('content_type')"
  );
  assert.equal(cols.length, 1, "002 的 content_type 列应存在");
  const [cols3] = await app.pool.query<RowDataPacket[]>(
    "SELECT COLUMN_NAME AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations' AND COLUMN_NAME IN ('provider', 'model')"
  );
  assert.equal(cols3.length, 2, "003 的 provider/model 列应存在");
});
