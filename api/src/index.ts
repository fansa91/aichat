import { loadConfig } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { buildApp } from "./app.js";

async function main() {
  const cfg = loadConfig();
  const applied = await runMigrations(cfg);
  if (applied.length > 0) console.log(`migrations applied: ${applied.join(", ")}`);
  const app = await buildApp(cfg);
  await app.listen({ port: cfg.port, host: "127.0.0.1" });
  console.log(`aichat-api listening on 127.0.0.1:${cfg.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
