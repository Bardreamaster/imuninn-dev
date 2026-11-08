import { defineConfig } from "vite";

// Relative base so `dist/` works from any path (the relay serves it, or any static host).
export default defineConfig({
  base: "./",
  server: { host: true, port: 5173, fs: { allow: ["../.."] } },
  build: { target: "es2022" },
});
