const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const apiDir = path.join(__dirname, 'app', 'api');
const apiBackupDir = path.join(__dirname, 'app', '_api_backup');
const apiBakDir = path.join(__dirname, 'app', 'api.bak');
const apiBakBackupDir = path.join(__dirname, 'app', '_api_bak_backup');

const hasApiDir = fs.existsSync(apiDir);
const hasApiBakDir = fs.existsSync(apiBakDir);

try {
  // 1. Move API dir temporarily
  if (hasApiDir) {
    console.log('Moving app/api to app/_api_backup...');
    fs.renameSync(apiDir, apiBackupDir);
  }
  if (hasApiBakDir) {
    console.log('Moving app/api.bak to app/_api_bak_backup...');
    fs.renameSync(apiBakDir, apiBakBackupDir);
  }

  // 2. Build static export
  console.log('Building static export...');
  execSync('npm run build', { stdio: 'inherit' });

} finally {
  // 3. Restore API dir
  if (hasApiDir && fs.existsSync(apiBackupDir)) {
    console.log('Restoring app/api...');
    fs.renameSync(apiBackupDir, apiDir);
  }
  if (hasApiBakDir && fs.existsSync(apiBakBackupDir)) {
    console.log('Restoring app/api.bak...');
    fs.renameSync(apiBakBackupDir, apiBakDir);
  }
}

console.log('Build complete!');
