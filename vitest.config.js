import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Include patterns
    include: ['tests/**/*.test.js'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/capacitor/**/*.js',
        'src/main/**/*.cjs',
        'main.cjs'
      ],
      exclude: [
        'node_modules',
        'tests',
        'dist',
        'ios'
      ]
    },

    // Global test timeout
    testTimeout: 10000,

    // Setup files
    setupFiles: ['./tests/setup.js'],

    // Mock reset
    mockReset: true,

    // Reporter
    reporters: ['verbose']
  }
});
