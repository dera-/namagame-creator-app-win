#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function ensureOpenSsl() {
  const result = spawnSync("openssl", ["version"], { stdio: "ignore", shell: false });
  if (result.status !== 0) {
    throw new Error("OpenSSL is required. Please install openssl and run again.");
  }
}

function normalizeArg(prefix, fallback) {
  const arg = process.argv.find((entry) => entry.startsWith(`${prefix}=`));
  return arg ? arg.slice(prefix.length + 1) : fallback;
}

const days = Number(normalizeArg("--days", "825"));
const commonName = normalizeArg("--cn", "Namagame Creator Dev Signer");
const outDir = path.resolve(normalizeArg("--out", "certs/dev"));
const password = process.env.SELF_SIGN_CERT_PASSWORD || crypto.randomBytes(18).toString("base64url");

if (!Number.isFinite(days) || days < 1) {
  throw new Error("--days must be a positive number.");
}

ensureOpenSsl();
fs.mkdirSync(outDir, { recursive: true });

const keyPath = path.join(outDir, "codesign-dev.key.pem");
const certPath = path.join(outDir, "codesign-dev.crt.pem");
const p12Path = path.join(outDir, "codesign-dev.p12");
const pfxPath = path.join(outDir, "codesign-dev.pfx");
const readmePath = path.join(outDir, "README.txt");

run("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:4096",
  "-sha256",
  "-days",
  String(days),
  "-nodes",
  "-keyout",
  keyPath,
  "-out",
  certPath,
  "-subj",
  `/CN=${commonName}`,
  "-addext",
  "keyUsage=digitalSignature",
  "-addext",
  "extendedKeyUsage=codeSigning",
]);

run("openssl", [
  "pkcs12",
  "-export",
  "-inkey",
  keyPath,
  "-in",
  certPath,
  "-name",
  commonName,
  "-out",
  p12Path,
  "-passout",
  `pass:${password}`,
]);

fs.copyFileSync(p12Path, pfxPath);

const readme = [
  "Self-signed code signing assets generated for local/dev distribution.",
  "",
  `Generated at: ${new Date().toISOString()}`,
  `Common Name: ${commonName}`,
  `Validity: ${days} days`,
  "",
  "Files:",
  "- codesign-dev.key.pem (private key)",
  "- codesign-dev.crt.pem (certificate)",
  "- codesign-dev.p12 / codesign-dev.pfx (for electron-builder CSC_LINK)",
  "",
  "Set environment variables before build:",
  `export CSC_LINK=\"${p12Path}\"`,
  `export CSC_KEY_PASSWORD=\"${password}\"`,
  `export SIGN_CERT_PATH=\"${certPath}\"`,
  `export SIGN_KEY_PATH=\"${keyPath}\"`,
  "export SIGNING_MODE=self-signed",
  "",
  "Important:",
  "- Keep private key and password secret.",
  "- Do not commit this directory.",
].join("\n");

fs.writeFileSync(readmePath, `${readme}\n`, "utf8");

console.log("\nGenerated self-signed certificate bundle:");
console.log(`- ${keyPath}`);
console.log(`- ${certPath}`);
console.log(`- ${p12Path}`);
console.log(`- ${pfxPath}`);
console.log("\nCredentials:");
console.log(`SELF_SIGN_CERT_PASSWORD=${password}`);
console.log(`\nA helper file was written to ${readmePath}`);
