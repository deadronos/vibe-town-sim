import { defineConfig } from "vite";
const local = { host: "127.0.0.1", port: Number(process.env.PORT || 4173), strictPort: true };
export default defineConfig({ base: "./", server: local, preview: local });
