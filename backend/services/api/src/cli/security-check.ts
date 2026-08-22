import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';
import { createPool } from '../persistence/database.js';

type RoleAttributes = {
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
};

type PrivilegeRow = {
  relation: string;
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  truncate: boolean;
  references: boolean;
  trigger: boolean;
};

const config = loadConfig();
if (!config.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL is required for the privilege scorecard');

const runtimePool = createPool(config.DATABASE_URL, 'keystone-security-runtime');
const adminPool = createPool(config.DATABASE_ADMIN_URL, 'keystone-security-admin');

const expectedPrivileges: Record<string, Omit<PrivilegeRow, 'relation'>> = {
  'public.tenants': { select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
  'public.source_records': { select: true, insert: true, update: false, delete: false, truncate: false, references: false, trigger: false },
  'public.field_observations': { select: true, insert: true, update: false, delete: false, truncate: false, references: false, trigger: false },
  'public.canonical_entities': { select: true, insert: true, update: true, delete: false, truncate: false, references: false, trigger: false },
  'public.proposals': { select: true, insert: true, update: true, delete: false, truncate: false, references: false, trigger: false },
  'public.jobs': { select: true, insert: true, update: true, delete: false, truncate: false, references: false, trigger: false },
  'public.audit_events': { select: true, insert: true, update: false, delete: false, truncate: false, references: false, trigger: false },
  'source_app.students': { select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
  'source_app.enrollments': { select: true, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false }
};

let scorecard: Record<string, unknown> | undefined;

try {
  const currentUser = await runtimePool.query<{ current_user: string }>('SELECT current_user');
  assert.equal(currentUser.rows[0]?.current_user, config.RUNTIME_DATABASE_USER);

  const attributes = await adminPool.query<RoleAttributes>(
    `SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = $1`,
    [config.RUNTIME_DATABASE_USER]
  );
  assert.deepEqual(attributes.rows[0], {
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    rolbypassrls: false
  });

  const access = await adminPool.query<{
    connect: boolean;
    public_usage: boolean;
    public_create: boolean;
    source_usage: boolean;
    source_create: boolean;
  }>(
    `SELECT
      has_database_privilege($1, current_database(), 'CONNECT') AS connect,
      has_schema_privilege($1, 'public', 'USAGE') AS public_usage,
      has_schema_privilege($1, 'public', 'CREATE') AS public_create,
      has_schema_privilege($1, 'source_app', 'USAGE') AS source_usage,
      has_schema_privilege($1, 'source_app', 'CREATE') AS source_create`,
    [config.RUNTIME_DATABASE_USER]
  );
  assert.deepEqual(access.rows[0], {
    connect: true,
    public_usage: true,
    public_create: false,
    source_usage: true,
    source_create: false
  });

  const relations = Object.keys(expectedPrivileges);
  const privileges = await adminPool.query<PrivilegeRow>(
    `SELECT relation,
      has_table_privilege($1, relation, 'SELECT') AS select,
      has_table_privilege($1, relation, 'INSERT') AS insert,
      has_table_privilege($1, relation, 'UPDATE') AS update,
      has_table_privilege($1, relation, 'DELETE') AS delete,
      has_table_privilege($1, relation, 'TRUNCATE') AS truncate,
      has_table_privilege($1, relation, 'REFERENCES') AS references,
      has_table_privilege($1, relation, 'TRIGGER') AS trigger
      FROM unnest($2::text[]) AS relation
      ORDER BY relation`,
    [config.RUNTIME_DATABASE_USER, relations]
  );
  for (const row of privileges.rows) {
    const expected = expectedPrivileges[row.relation];
    assert.ok(expected, `unexpected relation in privilege scorecard: ${row.relation}`);
    assert.deepEqual({ ...row, relation: undefined }, { ...expected, relation: undefined }, `privilege mismatch for ${row.relation}`);
  }
  assert.equal(privileges.rowCount, relations.length);

  scorecard = {
    status: 'pass',
    runtimeRole: config.RUNTIME_DATABASE_USER,
    roleAttributes: attributes.rows[0],
    databaseAndSchemas: access.rows[0],
    relations: privileges.rows
  };
} finally {
  await runtimePool.end();
  await adminPool.end();
}

process.stdout.write(`${JSON.stringify(scorecard, null, 2)}\n`);
