import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json.
  plugins: [tsconfigPaths()],

  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],

    /*
     * Integration tests use shared PostgreSQL and LocalStack resources.
     * Running test files sequentially prevents independent consumers from
     * competing for messages from the same FIFO queue.
     *
     * This affects test execution only. Production remains multi-instance
     * and concurrency is still exercised explicitly by integration tests.
     */
    fileParallelism: false,
  },
});