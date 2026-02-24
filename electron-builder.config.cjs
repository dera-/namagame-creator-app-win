const signingMode = process.env.SIGNING_MODE || "none";
const isProductionSigning = signingMode === "production";

module.exports = {
  appId: "com.namagame.creator",
  productName: "Namagame Creator",
  executableName: "namagame-creator",
  afterAllArtifactBuild: "tools/signing/after-all-artifact-build.cjs",
  afterSign: "tools/signing/after-sign.cjs",
  forceCodeSigning: isProductionSigning,
  win: {
    target: ["nsis", "zip"],
    verifyUpdateCodeSignature: false,
  },
  mac: {
    target: ["zip"],
    hardenedRuntime: isProductionSigning,
    gatekeeperAssess: false,
  },
  linux: {
    target: ["AppImage", "tar.gz"],
    category: "Utility",
  },
  directories: {
    output: "dist",
  },
  files: [
    "script/**",
    "akashic-mcp/**",
    "package.json",
    "node_modules/**",
  ],
  asar: true,
  asarUnpack: ["akashic-mcp/**"],
  extraResources: [
    {
      from: "akashic-mcp",
      to: "akashic-mcp",
      filter: ["**/*"],
    },
  ],
  publish: [
    {
      provider: "github",
      owner: "dera-",
      repo: "namagame-creator-app-win",
    },
  ],
};
