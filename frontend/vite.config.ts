/// <reference types="vitest/config" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The only inline script is the theme bootstrap in index.html. Its hash is computed here so the policy stays correct when it changes.
const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(readFileSync("index.html", "utf8"))?.[1] ?? "";
const scriptHash = createHash("sha256").update(inlineScript).digest("base64");
// Recommended policy for serving the built app (also used by `npm run preview`). style-src needs 'unsafe-inline' because the charts set inline styles.
export const CSP = [
  "default-src 'self'", `script-src 'self' 'sha256-${scriptHash}'`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8001" } },
  preview: { port: 4173, proxy: { "/api": "http://127.0.0.1:8001" }, headers: { "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"], css: false },
});
