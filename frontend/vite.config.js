import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// UPI Distributed Transaction Simulator - frontend (educational project)
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
