import { createRequire } from "node:module";
import type DLMM from "@meteora-ag/dlmm";

/**
 * Load the @meteora-ag/dlmm SDK via its CJS build.
 *
 * The ESM build (dist/index.mjs) re-exports `BN` from @coral-xyz/anchor,
 * which Node's CJS-ESM interop cannot resolve as a named export (lexer
 * limitation) — `import ... from "@meteora-ag/dlmm"` crashes at runtime.
 * The CJS build works and its require-interop returns the DLMM class itself.
 */
export function loadDlmmModule(): typeof DLMM {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const mod = require("@meteora-ag/dlmm") as unknown;
  // CJS interop makes the default export (DLMM class) the module itself.
  const candidate = mod as { DLMM?: typeof DLMM } & typeof DLMM;
  return (candidate.DLMM ?? candidate) as typeof DLMM;
}

/**
 * Load the full SDK module (named exports incl. the StrategyType enum).
 * Same CJS interop trick as loadDlmmModule.
 */
export function loadSdkModule(): typeof import("@meteora-ag/dlmm") {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return require("@meteora-ag/dlmm") as typeof import("@meteora-ag/dlmm");
}
