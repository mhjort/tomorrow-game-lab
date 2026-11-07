import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// Publish-ready defaults (see the publish-web-game skill):
// - base './': relative URLs, so the build works under any sub-path (GitHub Pages /<repo>/, itch.io, ...)
// - three.js in its own chunk (long-term caching); Rapier is a dynamic import -> separate JS chunk + .wasm
//   that the loader fetches in parallel with the models.
export default defineConfig({
  base: './',
  plugins: [wasm()], // Rapier ships ESM-integrated .wasm
  build: {
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
