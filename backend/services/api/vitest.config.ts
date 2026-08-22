import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/domain/**/*.ts',
        'src/sources/**/*.ts',
        'src/reconciliation/**/*.ts',
        'src/fixtures/reader.ts',
        'src/ingestion/**/*.ts',
        'src/jobs/**/*.ts',
        'src/persistence/database.ts',
        'src/persistence/queries.ts',
        'src/persistence/migrations.ts'
      ],
      exclude: ['src/**/*.d.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 75 }
    }
  }
});
