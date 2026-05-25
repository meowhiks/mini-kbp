const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const apiDir = path.join(__dirname, "app", "api");
const apiBackupDir = path.join(__dirname, "app", "_api_backup");
const apiBakDir = path.join(__dirname, "app", "api.bak");
const apiBakBackupDir = path.join(__dirname, "app", "_api_bak_backup");
const outDir = path.join(__dirname, "out");

const hasApiDir = fs.existsSync(apiDir);
const hasApiBakDir = fs.existsSync(apiBakDir);

let buildOk = false;

try {
  if (fs.existsSync(outDir)) {
    console.log("Cleaning out/ (fresh static export)...");
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  if (hasApiDir) {
    console.log("Moving app/api to app/_api_backup...");
    fs.renameSync(apiDir, apiBackupDir);
  }
  if (hasApiBakDir) {
    console.log("Moving app/api.bak to app/_api_bak_backup...");
    fs.renameSync(apiBakDir, apiBakBackupDir);
  }

  console.log("Building static export...");
  execSync("npm run build", { stdio: "inherit" });

  if (!fs.existsSync(path.join(outDir, "index.html"))) {
    throw new Error("out/index.html not found after build");
  }

  fs.writeFileSync(
    path.join(outDir, ".build-stamp"),
    `${new Date().toISOString()}\n`,
    "utf8"
  );
  buildOk = true;
} catch (err) {
  console.error("\n[build:mobile] FAILED — out/ was not updated. Do not run cap:sync.");
  const code = err && typeof err === "object" && "status" in err ? Number(err.status) || 1 : 1;
  process.exit(code);
} finally {
  if (hasApiDir && fs.existsSync(apiBackupDir)) {
    console.log("Restoring app/api...");
    fs.renameSync(apiBackupDir, apiDir);
  }
  if (hasApiBakDir && fs.existsSync(apiBakBackupDir)) {
    console.log("Restoring app/api.bak...");
    fs.renameSync(apiBakBackupDir, apiBakDir);
  }
}

if (!buildOk) {
  process.exit(1);
}

console.log("Build complete! out/ is ready for cap sync.");
