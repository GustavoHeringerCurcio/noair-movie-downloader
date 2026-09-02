import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export async function runSchema(pool: pg.Pool): Promise<void> {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
