const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const rootDir = path.join(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const lockPath = path.join(rootDir, 'package-lock.json');
const gitDir = path.join(rootDir, '.git');

// Skip during merges or rebases
if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD')) ||
    fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
    fs.existsSync(path.join(gitDir, 'rebase-apply'))) {
  console.log('ℹ Merge or rebase in progress, skipping auto-version bump.');
  process.exit(0);
}

// Skip if requested by environment
if (process.env.SKIP_VERSION_BUMP === '1' || process.env.SKIP_VERSION_BUMP === 'true') {
  console.log('ℹ SKIP_VERSION_BUMP is set, skipping auto-version bump.');
  process.exit(0);
}

if (!fs.existsSync(pkgPath)) {
  console.error(`❌ package.json not found at ${pkgPath}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;

// Check if version was already manually modified and staged
try {
  const stagedDiff = execSync('git diff --cached package.json', { cwd: rootDir, encoding: 'utf8' });
  if (/^\+[ \t]*"version":/m.test(stagedDiff)) {
    console.log(`ℹ Version was already modified in staged package.json (v${currentVersion}), keeping it.`);
    process.exit(0);
  }
} catch {
  // If git diff fails (e.g. no git repo), continue
}

// Determine target version
let nextVersion = process.env.VERSION ? process.env.VERSION.trim().replace(/^v/, '') : null;

if (!nextVersion) {
  const semverMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!semverMatch) {
    console.error(`❌ Current version "${currentVersion}" in package.json is not valid semver (X.Y.Z)`);
    process.exit(1);
  }

  let [, majorStr, minorStr, patchStr, extra] = semverMatch;
  let major = parseInt(majorStr, 10);
  let minor = parseInt(minorStr, 10);
  let patch = parseInt(patchStr, 10);

  const bumpType = (process.env.BUMP || 'patch').toLowerCase();
  if (bumpType === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpType === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  nextVersion = `${major}.${minor}.${patch}${extra || ''}`;
}

// Update package.json
pkg.version = nextVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// Update package-lock.json
if (fs.existsSync(lockPath)) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.version = nextVersion;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = nextVersion;
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.warn('⚠️ Could not update package-lock.json:', err.message);
  }
}

// Stage updated files in Git
try {
  execSync('git add package.json package-lock.json', { cwd: rootDir, stdio: 'inherit' });
  console.log(`✔ Auto-incremented version: v${currentVersion} ➔ v${nextVersion}`);
} catch (err) {
  console.error('❌ Failed to stage updated package files:', err.message);
  process.exit(1);
}
