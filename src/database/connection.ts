import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const defaultDatabasePath = resolve(process.env.DATABASE_PATH ?? 'data/claims.sqlite');

export function openDatabase(path = defaultDatabasePath): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  database.pragma('foreign_keys = ON');
  return database;
}
