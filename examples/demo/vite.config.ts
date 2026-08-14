import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* dedupe is not optional here. The demo links the package from the workspace,
 * and without this the linked package and the app can each resolve their own
 * copy of three or of react. Two three instances inside one renderer fail in
 * ways that read as engine bugs, so pin one copy of each. */
/* The published demo lives under a path, not at a root, so the build is based
 * at /nebula/ and lands in dist/nebula: the asset server matches URL paths to
 * file paths literally, so the built directory has to mirror the URL. Asset
 * urls in code go through import.meta.env.BASE_URL, which follows this. Dev
 * still serves at "/" because base only applies to the build. */
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/nebula/" : "/",
  build: { outDir: "dist/nebula", emptyOutDir: true },
  plugins: [react()],
  resolve: {
    dedupe: ["three", "react", "react-dom", "@react-three/fiber"],
  },
}));
