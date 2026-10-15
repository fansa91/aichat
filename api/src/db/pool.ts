import mysql from "mysql2/promise";
import type { AppConfig } from "../config.js";

export type Pool = mysql.Pool;

export function createPool(cfg: AppConfig): Pool {
  return mysql.createPool({
    host: cfg.db.host,
    port: cfg.db.port,
    user: cfg.db.user,
    password: cfg.db.password,
    database: cfg.db.name,
    waitForConnections: true,
    connectionLimit: 10,
    charset: "utf8mb4",
  });
}
