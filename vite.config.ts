import { defineConfig } from "vite";
import { resolve } from "node:path";

/** Five real HTML pages, one shared entry graph. */
export default defineConfig({
  server: { host: true, port: 5173 },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        ide: resolve(__dirname, "ide.html"),
        lab: resolve(__dirname, "lab.html"),
        specs: resolve(__dirname, "specs.html"),
        docs: resolve(__dirname, "docs.html"),
      },
    },
  },
});
