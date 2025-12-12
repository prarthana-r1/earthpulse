import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],

  build: {
    outDir: "dist",
    copyPublicDir: true,   // IMPORTANT for sw.js
  },

  server: {
    proxy: {
      "/api": {
        target: "https://earthpulse-backend-48598371636.asia-south1.run.app",
        changeOrigin: true,
      },
    },
  },
});
