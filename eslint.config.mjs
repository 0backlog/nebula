import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/* The react-hooks plugin is not decoration: field.tsx carries two deliberate
 * exhaustive-deps disables (the buffers must allocate exactly once, at
 * capacity, and never on a dependency change), and a disable comment for a
 * rule nobody runs is a lie. */
export default tseslint.config(
  { ignores: ["dist", "examples/*/dist", "node_modules"] },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "examples/demo/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
