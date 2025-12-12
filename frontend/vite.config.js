export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],

  build: {
    outDir: "dist",
    copyPublicDir: true,   // ⬅ copies public/sw.js → dist/sw.js
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
