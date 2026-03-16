#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const bindingsByPlatformAndArch = {
  android: {
    arm: "android-arm-eabi",
    arm64: "android-arm64"
  },
  darwin: {
    arm64: "darwin-arm64",
    x64: "darwin-x64"
  },
  linux: {
    arm: "linux-arm-gnueabihf",
    arm64: "linux-arm64-gnu",
    ppc64: "linux-powerpc64le-gnu",
    riscv64: "linux-riscv64-gnu",
    s390x: "linux-s390x-gnu",
    x64: "linux-x64-gnu"
  },
  win32: {
    arm64: "win32-arm64-msvc",
    ia32: "win32-ia32-msvc",
    x64: "win32-x64-msvc"
  }
};

const platform = process.platform;
const arch = process.arch;
const packageBase = bindingsByPlatformAndArch[platform]?.[arch];

if (!packageBase) {
  console.warn(
    `[validate-rollup-native] Unsupported platform/arch combination: ${platform}/${arch}. Skipping check.`
  );
  process.exit(0);
}

const rollupNativeDir = path.join(
  process.cwd(),
  "node_modules",
  "@akashic",
  "akashic-cli-export",
  "node_modules",
  "@rollup",
  `rollup-${packageBase}`
);

if (!fs.existsSync(rollupNativeDir)) {
  console.error(
    [
      "[validate-rollup-native] Missing Rollup native package for this build environment.",
      `Expected: ${rollupNativeDir}`,
      "",
      "This usually happens when optional dependencies were skipped during install,",
      "or when the app is packaged on a different CPU architecture than the target macOS machine.",
      "",
      "Try the following:",
      "1. Remove node_modules and package-lock.json",
      "2. Run npm install again on the same OS/CPU architecture that will build the app",
      "3. Re-run npm run pack"
    ].join("\n")
  );
  process.exit(1);
}

console.log(
  `[validate-rollup-native] Found ${path.relative(process.cwd(), rollupNativeDir)}`
);
