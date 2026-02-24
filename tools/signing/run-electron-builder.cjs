#!/usr/bin/env node
const { spawnSync } = require("node:child_process");

const mode = process.argv[2] || process.env.SIGNING_MODE || "none";
const targets = process.argv.slice(3);
const electronBuilderBin = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";

const env = {
  ...process.env,
  SIGNING_MODE: mode,
};

const result = spawnSync(electronBuilderBin, ["--config", "electron-builder.config.cjs", ...targets], {
  stdio: "inherit",
  shell: false,
  env,
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
