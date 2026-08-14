/* Two post-build steps the bundler cannot do for us.
 *
 * 1. The "use client" directive. field.tsx carries it, but a bundler treats a
 *    module level directive as meaningless once modules are merged and drops
 *    it, and tsup's banner option goes the same way. Without the directive on
 *    the published bundle every React Server Components host fails on import.
 *    It is prepended to the FIRST LINE rather than on a line of its own, so
 *    the sourcemap's line numbers still line up with the code.
 *
 * 2. The neutral face as data. The bundle already inlines a copy, but a host
 *    authoring its own asset needs a reference file to diff against, and
 *    "@0backlog/nebula/face-neutral.json" is the exports entry that serves it. */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTIVE = '"use client";';

const bundle = join(root, "dist", "index.js");
const code = readFileSync(bundle, "utf8");
if (!code.startsWith(DIRECTIVE)) writeFileSync(bundle, DIRECTIVE + code);

copyFileSync(
  join(root, "src", "field-face-neutral.json"),
  join(root, "dist", "face-neutral.json"),
);
