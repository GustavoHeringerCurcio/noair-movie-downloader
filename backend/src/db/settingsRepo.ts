import type pg from 'pg';

export interface SettingsRepository {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export function createSettingsRepository(pool: pg.Pool): SettingsRepository {
  async function get<T>(key: string): Promise<T | null> {
    const result = await pool.query<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key]);
    const row = result.rows[0];
    return row ? row.value : null;
  }

  async function set<T>(key: string, value: T): Promise<void> {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    );
  }

  return { get, set };
}
