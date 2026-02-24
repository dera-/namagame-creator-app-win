const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const LINUX_EXTENSIONS = [
  ".AppImage",
  ".deb",
  ".rpm",
  ".snap",
  ".pacman",
  ".tar.gz",
  ".tar.xz",
  ".zip",
];

function isLinuxArtifact(filePath) {
  const fileName = path.basename(filePath);
  return LINUX_EXTENSIONS.some((ext) => fileName.endsWith(ext)) || /linux/i.test(fileName);
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

module.exports = async function afterAllArtifactBuild(context) {
  const signingMode = process.env.SIGNING_MODE || "none";
  if (signingMode === "none") {
    return;
  }

  const certPath = process.env.SIGN_CERT_PATH;
  const keyPath = process.env.SIGN_KEY_PATH;

  if (!certPath || !keyPath) {
    console.log("[sign-linux] SIGN_CERT_PATH or SIGN_KEY_PATH is not set. Linux signature generation is skipped.");
    return;
  }

  const opensslCheck = spawnSync("openssl", ["version"], { stdio: "ignore", shell: false });
  if (opensslCheck.status !== 0) {
    console.log("[sign-linux] openssl not found. Linux signature generation is skipped.");
    return;
  }

  const artifactPaths = Array.isArray(context?.artifactPaths) ? context.artifactPaths : [];
  const linuxArtifacts = artifactPaths.filter((artifactPath) => isLinuxArtifact(artifactPath));

  if (linuxArtifacts.length === 0) {
    return;
  }

  const outDir = context?.outDir || path.dirname(linuxArtifacts[0]);
  const sumsPath = path.join(outDir, "SHA256SUMS-linux.txt");
  const sigPath = `${sumsPath}.sig`;
  const pubCertPath = path.join(outDir, "linux-signing-cert.pem");

  const lines = linuxArtifacts
    .map((artifactPath) => `${sha256(artifactPath)}  ${path.basename(artifactPath)}`)
    .join("\n");
  fs.writeFileSync(sumsPath, `${lines}\n`, "utf8");

  run("openssl", [
    "dgst",
    "-sha256",
    "-sign",
    keyPath,
    "-out",
    sigPath,
    sumsPath,
  ]);

  fs.copyFileSync(certPath, pubCertPath);

  console.log(`[sign-linux] Generated ${path.basename(sumsPath)}`);
  console.log(`[sign-linux] Generated ${path.basename(sigPath)}`);
  console.log(`[sign-linux] Copied ${path.basename(pubCertPath)}`);
};
