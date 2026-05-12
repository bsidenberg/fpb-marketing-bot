import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const VERCEL_API = 'https://fpb-marketing-bot.vercel.app';
const proxyTarget = { target: VERCEL_API, changeOrigin: true, secure: true };

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // GET-only allowlist — read endpoints with no same-path mutation
      // handler. Mutations (POST/PATCH to /api/actions, /api/chat,
      // /api/leads, /api/approve-action, /api/image-process,
      // /api/actions/[id]) are intentionally NOT proxied so they fail
      // loudly on localhost rather than silently hitting prod.
      '/api/accounts':              proxyTarget,
      '/api/performance-snapshots': proxyTarget,
      '/api/account-budget':        proxyTarget,
      '/api/google-ads':            proxyTarget,
      '/api/facebook-ads':          proxyTarget,
      '/api/automation-log':        proxyTarget,
      '/api/action-outcomes':       proxyTarget,
    },
  },
});
