/**
 * Schema migrations.
 *
 * The stored document carries a `schemaVersion`. On every load (from
 * localStorage OR from the shared Gist, which may have been written by a device
 * running an older build) the document is walked forward through the migration
 * list until it matches SCHEMA_VERSION, then validated.
 *
 * Rules for adding one:
 *   1. Bump SCHEMA_VERSION in schema.ts.
 *   2. Append `{ to: <new version>, describe, up }` below. Never edit or
 *      reorder a shipped migration -- the other person's phone may still be on
 *      the old version and will replay these in order.
 *   3. Migrations take and return plain unknown/any JSON. They must be pure and
 *      must tolerate partially broken input (validation runs after, not before).
 */

import { SCHEMA_VERSION } from './schema';

export interface Migration {
  /** Version this migration produces. */
  to: number;
  describe: string;
  up: (doc: Record<string, unknown>) => Record<string, unknown>;
}

export const MIGRATIONS: Migration[] = [
  {
    to: 1,
    describe: 'Initial schema: settings, groups, categories, transactions, assignments.',
    up: (doc) => ({
      ...doc,
      settings: doc.settings ?? {},
      groups: Array.isArray(doc.groups) ? doc.groups : [],
      categories: Array.isArray(doc.categories) ? doc.categories : [],
      transactions: Array.isArray(doc.transactions) ? doc.transactions : [],
      assignments: doc.assignments ?? {},
      schemaVersion: 1,
    }),
  },

  // --- Add future migrations here, e.g.
  // {
  //   to: 2,
  //   describe: 'Add per-category notes.',
  //   up: (doc) => ({ ...doc, schemaVersion: 2 }),
  // },
];

export interface MigrationResult {
  doc: Record<string, unknown>;
  applied: string[];
  /** Document came from a build newer than this one. */
  fromFuture: boolean;
}

export function migrate(input: unknown): MigrationResult {
  const doc: Record<string, unknown> =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};

  const rawVersion = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;
  const applied: string[] = [];

  if (rawVersion > SCHEMA_VERSION) {
    // Forward-compat: don't mangle it. Validation will drop fields this build
    // doesn't understand, and the caller warns the user before committing.
    return { doc, applied, fromFuture: true };
  }

  let current = doc;
  for (const migration of MIGRATIONS) {
    if (migration.to > rawVersion) {
      current = migration.up(current);
      current.schemaVersion = migration.to;
      applied.push(`v${migration.to}: ${migration.describe}`);
    }
  }
  current.schemaVersion = SCHEMA_VERSION;
  return { doc: current, applied, fromFuture: false };
}
