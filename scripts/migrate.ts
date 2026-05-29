#!/usr/bin/env npx ts-node
/**
 * Database migration runner.
 *
 * Usage:
 *   npx ts-node scripts/migrate.ts               # apply all pending migrations
 *   npx ts-node scripts/migrate.ts --dry-run      # preview without applying
 *   npx ts-node scripts/migrate.ts --status       # show applied / pending state
 *   npx ts-node scripts/migrate.ts --rollback <n> # roll back last n migrations (requires .down.sql files)
 *   npx ts-node scripts/migrate.ts --validate     # check file naming & duplicates only
 *
 * Environment:
 *   DATABASE_URL  PostgreSQL connection string
 */

import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

// ── Configuration ────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const MIGRATIONS_TABLE = 'schema_migrations';
const MIGRATION_FILE_PATTERN = /^(\d{3})_.+\.sql$/;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  process.stdout.write(`${msg}\n`);
}

function err(msg: string) {
  process.stderr.write(`ERROR: ${msg}\n`);
}

interface MigrationFile {
  version: string;
  name: string;
  filePath: string;
}

function loadMigrationFiles(dir: string): MigrationFile[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Migrations directory not found: ${dir}`);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => MIGRATION_FILE_PATTERN.test(f) && !f.endsWith('.down.sql'))
    .sort();

  const seen = new Set<string>();
  const migrations: MigrationFile[] = [];

  for (const file of files) {
    const match = file.match(MIGRATION_FILE_PATTERN);
    if (!match) continue;
    const version = match[1];

    if (seen.has(version)) {
      throw new Error(`Duplicate migration version ${version}: ${file}`);
    }
    seen.add(version);

    migrations.push({
      version,
      name: file.replace('.sql', ''),
      filePath: path.join(dir, file),
    });
  }

  return migrations;
}

function validateMigrations(migrations: MigrationFile[]): void {
  const versions = migrations.map((m) => Number(m.version));
  for (let i = 0; i < versions.length; i++) {
    if (versions[i] !== i + 1) {
      throw new Error(
        `Migration sequence gap detected: expected ${String(i + 1).padStart(3, '0')}, got ${migrations[i].version}`
      );
    }
  }
  log(`Validation passed — ${migrations.length} migration file(s) OK.`);
}

// ── Database helpers ──────────────────────────────────────────────────────────

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  BIGINT NOT NULL
    )
  `);
}

async function getAppliedVersions(client: Client): Promise<Set<string>> {
  const result = await client.query<{ version: string }>(
    `SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`
  );
  return new Set(result.rows.map((r) => r.version));
}

async function recordMigration(client: Client, migration: MigrationFile): Promise<void> {
  await client.query(
    `INSERT INTO ${MIGRATIONS_TABLE} (version, name, applied_at) VALUES ($1, $2, $3)
     ON CONFLICT (version) DO NOTHING`,
    [migration.version, migration.name, Date.now()]
  );
}

async function removeMigrationRecord(client: Client, version: string): Promise<void> {
  await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = $1`, [version]);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function runMigrations(client: Client, dryRun: boolean): Promise<void> {
  const migrations = loadMigrationFiles(MIGRATIONS_DIR);
  const applied = await getAppliedVersions(client);

  const pending = migrations.filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    log('No pending migrations.');
    return;
  }

  log(`${pending.length} pending migration(s)${dryRun ? ' (DRY RUN)' : ''}:`);

  for (const migration of pending) {
    log(`  → ${migration.name}`);

    if (dryRun) continue;

    const sql = fs.readFileSync(migration.filePath, 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await recordMigration(client, migration);
      await client.query('COMMIT');
      log(`    ✓ applied`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${migration.name} failed: ${(e as Error).message}`);
    }
  }

  if (!dryRun) log(`\nDone — ${pending.length} migration(s) applied.`);
}

async function showStatus(client: Client): Promise<void> {
  const migrations = loadMigrationFiles(MIGRATIONS_DIR);
  const applied = await getAppliedVersions(client);

  log(`\nMigration status (${MIGRATIONS_DIR}):\n`);
  log(`  ${'VERSION'.padEnd(8)} ${'STATUS'.padEnd(10)} NAME`);
  log(`  ${'-'.repeat(60)}`);

  for (const m of migrations) {
    const status = applied.has(m.version) ? 'applied' : 'pending';
    log(`  ${m.version.padEnd(8)} ${status.padEnd(10)} ${m.name}`);
  }

  const pendingCount = migrations.filter((m) => !applied.has(m.version)).length;
  log(`\n  ${migrations.length - pendingCount} applied, ${pendingCount} pending.`);
}

async function rollback(client: Client, steps: number): Promise<void> {
  const migrations = loadMigrationFiles(MIGRATIONS_DIR);
  const applied = await getAppliedVersions(client);

  const toRollback = migrations
    .filter((m) => applied.has(m.version))
    .slice(-steps)
    .reverse();

  if (toRollback.length === 0) {
    log('Nothing to roll back.');
    return;
  }

  log(`Rolling back ${toRollback.length} migration(s):`);

  for (const migration of toRollback) {
    const downPath = migration.filePath.replace('.sql', '.down.sql');

    if (!fs.existsSync(downPath)) {
      err(`No down migration found for ${migration.name} (expected ${downPath})`);
      process.exit(1);
    }

    const sql = fs.readFileSync(downPath, 'utf8');
    log(`  ← ${migration.name}`);

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await removeMigrationRecord(client, migration.version);
      await client.query('COMMIT');
      log(`    ✓ rolled back`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Rollback of ${migration.name} failed: ${(e as Error).message}`);
    }
  }

  log(`\nDone — ${toRollback.length} migration(s) rolled back.`);
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function notify(message: string): Promise<void> {
  const webhookUrl = process.env.MIGRATION_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const { default: https } = await import('https');
    const body = JSON.stringify({ text: message });
    const url = new URL(webhookUrl);

    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        { hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (res) => { res.resume(); resolve(); }
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch {
    // Non-fatal — migration already completed.
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const statusOnly = args.includes('--status');
  const validateOnly = args.includes('--validate');
  const rollbackIdx = args.indexOf('--rollback');
  const rollbackSteps = rollbackIdx !== -1 ? Number(args[rollbackIdx + 1] ?? '1') : 0;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    err('DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  // Validation-only mode needs no DB connection.
  if (validateOnly) {
    const migrations = loadMigrationFiles(MIGRATIONS_DIR);
    validateMigrations(migrations);
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    if (statusOnly) {
      await showStatus(client);
      return;
    }

    if (rollbackSteps > 0) {
      await rollback(client, rollbackSteps);
      await notify(`[stellar-spend] Rolled back ${rollbackSteps} migration(s).`);
      return;
    }

    await runMigrations(client, dryRun);

    if (!dryRun) {
      await notify('[stellar-spend] Database migrations applied successfully.');
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  err((e as Error).message);
  process.exit(1);
});
