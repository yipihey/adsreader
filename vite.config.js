import { defineConfig } from 'vite';
import { resolve } from 'path';

// Plugin to transform app.js script tag to module for bundling
function addModuleTypePlugin() {
  return {
    name: 'add-module-type',
    enforce: 'pre', // Run before vite scans for dependencies
    transformIndexHtml: {
      order: 'pre', // Also use pre-order for transformIndexHtml
      handler(html) {
        // Transform <script src="app.js"> to <script type="module" src="app.js">
        // This allows vite to bundle it while keeping Electron dev mode working
        return html.replace(
          /<script src="app\.js"><\/script>/,
          '<script type="module" src="app.js"></script>'
        );
      },
    },
  };
}

export default defineConfig({
  // Build configuration for Capacitor
  root: 'src/renderer',
  base: './', // Relative paths for Capacitor

  plugins: [addModuleTypePlugin()],

  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    // Don't minify for easier debugging during development
    minify: process.env.NODE_ENV === 'production',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },

  server: {
    port: 5173,
    strictPort: true,
  },

  // Optimize dependencies
  optimizeDeps: {
    include: ['sql.js'],
    exclude: ['electron'],
  },

  // Define environment variables
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },

  // Resolve aliases
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      // Note: @capacitor/* packages are npm modules, don't alias them
    },
  },
});
