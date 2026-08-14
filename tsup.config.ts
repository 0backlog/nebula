import { defineConfig } from "tsup";

/* One ESM bundle from one entry.
 *
 * external is load bearing: react, react-dom, three and @react-three/fiber are
 * peers. Bundle any of them and a host ends up with two copies of three inside
 * one renderer, which fails in ways that look like engine bugs.
 *
 * The "use client" directive that field.tsx carries does NOT survive bundling
 * (a module level directive is meaningless once modules merge, so it is
 * dropped, banner option included). scripts/finish-build.mjs puts it back and
 * scripts/check-build.mjs fails the build if it is missing.
 *
 * Types come from tsc (tsconfig.build.json), not from tsup's dts rollup: the
 * JSX in field.tsx leans on the global element augmentation @react-three/fiber
 * publishes, and the compiler that typechecks it should be the one that writes
 * the declarations, so the two can never disagree. */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2020",
  sourcemap: true,
  clean: true,
  dts: false,
  treeshake: true,
  external: ["react", "react-dom", "three", "@react-three/fiber"],
});
