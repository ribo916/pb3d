import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const resolvePath = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolvePath('./index.html'),
        characterPreview: resolvePath('./character-preview/index.html'),
        drillBuilder: resolvePath('./tools/drill-builder.html')
      }
    }
  }
});
