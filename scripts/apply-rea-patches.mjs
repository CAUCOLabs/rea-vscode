import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const reaPatchDirectory = fileURLToPath(new URL('../patches/rea-6.7.0/', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`REA patch validation: ${message}`); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const safePath = relative => {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') ||
      relative.split('/').some(part => !part || part === '.' || part === '..') || path.posix.isAbsolute(relative)) {
    fail(`unsafe relative path: ${String(relative)}`);
  }
  return relative.split('/');
};

// Build inputs require exclusive ownership. Reject symlink components rather
// than following them outside the staging tree. This is not an adversarial
// concurrent-filesystem transaction; vendor-engine publishes a separate tree.
async function inspect(root, relative) {
  let current = root;
  const rootState = await lstat(current);
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) fail(`not a real directory: ${root}`);
  const parts = safePath(relative);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let state;
    try { state = await lstat(current); }
    catch (error) { if (error.code === 'ENOENT' && index === parts.length - 1) return undefined; throw error; }
    if (state.isSymbolicLink()) fail(`symbolic link rejected: ${relative}`);
    if (index < parts.length - 1 ? !state.isDirectory() : !state.isFile()) fail(`unexpected file type: ${relative}`);
  }
  return current;
}
async function readRegular(root, relative) {
  const file = await inspect(root, relative);
  if (!file) fail(`required file missing: ${relative}`);
  return readFile(file);
}
function applyEdits(original, edits, relative) {
  if (!Array.isArray(edits) || !edits.length) fail(`no edits for ${relative}`);
  let cursor = 0;
  const result = [];
  for (const edit of edits) {
    if (!Number.isSafeInteger(edit.offset) || edit.offset < cursor || edit.offset > original.length ||
        typeof edit.before !== 'string' || typeof edit.after !== 'string') fail(`invalid edit for ${relative}`);
    const before = Buffer.from(edit.before, 'utf8');
    if (!original.subarray(edit.offset, edit.offset + before.length).equals(before)) {
      fail(`exact edit bytes do not match at offset ${edit.offset}: ${relative}`);
    }
    result.push(original.subarray(cursor, edit.offset), Buffer.from(edit.after, 'utf8'));
    cursor = edit.offset + before.length;
  }
  result.push(original.subarray(cursor));
  return Buffer.concat(result);
}

/** Read and validate every input and computed output before any target writes. */
export async function prepareReaPatch(root, patchDirectory = reaPatchDirectory) {
  root = path.resolve(root);
  const manifestBytes = await readRegular(patchDirectory, 'manifest.json');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.manifestVersion !== 1 || manifest.patchFormat !== 'exact-byte-edits-v1' ||
      manifest.package?.name !== 'rea-agents' || manifest.package?.version !== '6.7.0') fail('unsupported patch manifest/package');
  const pkg = JSON.parse(await readRegular(root, 'package.json'));
  if (pkg.name !== manifest.package.name || pkg.version !== manifest.package.version) {
    fail(`requires rea-agents@6.7.0; received ${pkg.name}@${pkg.version}`);
  }
  if (!manifest.patch || !hash(manifest.patch.sha256)) fail('invalid patch integrity metadata');
  const patchBytes = await readRegular(patchDirectory, manifest.patch.file);
  if (sha256(patchBytes) !== manifest.patch.sha256) fail('patch asset SHA-256 mismatch');
  const patch = JSON.parse(patchBytes);
  if (patch.format !== manifest.patchFormat || !Array.isArray(patch.files) || !Array.isArray(manifest.applicationOrder) ||
      !manifest.applicationOrder.length) fail('invalid patch format/order');
  const sections = new Map();
  for (const section of patch.files) {
    safePath(section.path);
    if (sections.has(section.path)) fail(`duplicate patch section: ${section.path}`);
    sections.set(section.path, section.edits);
  }
  const seen = new Set();
  const files = [];
  for (const entry of manifest.applicationOrder) {
    safePath(entry.path);
    if (seen.has(entry.path) || !hash(entry.patchedSha256)) fail(`invalid/duplicate manifest entry: ${entry.path}`);
    seen.add(entry.path);
    const existing = await inspect(root, entry.path);
    let output;
    if (entry.operation === 'add') {
      if (entry.originalSha256 !== null || existing) fail(`new file must be absent (already/partially patched?): ${entry.path}`);
      output = await readRegular(patchDirectory, entry.source);
    } else if (entry.operation === 'edit') {
      if (!hash(entry.originalSha256) || !existing) fail(`original file missing/invalid: ${entry.path}`);
      const original = await readFile(existing);
      if (sha256(original) !== entry.originalSha256) fail(`original SHA-256 mismatch (modified or already/partially patched): ${entry.path}`);
      if (!sections.has(entry.path)) fail(`missing patch section: ${entry.path}`);
      output = applyEdits(original, sections.get(entry.path), entry.path);
      sections.delete(entry.path);
    } else fail(`unsupported operation: ${entry.operation}`);
    if (sha256(output) !== entry.patchedSha256) fail(`patched output SHA-256 mismatch: ${entry.path}`);
    files.push({ ...entry, output });
  }
  if (sections.size) fail('unused patch sections');
  return { root, files, manifestSha256: sha256(manifestBytes) };
}

/** Apply only to an exclusively owned staging tree, never to the active runtime. */
export async function applyReaPatch(root, patchDirectory = reaPatchDirectory) {
  const plan = await prepareReaPatch(root, patchDirectory);
  for (const entry of plan.files) {
    await writeFile(path.join(plan.root, entry.path), entry.output, { flag: entry.operation === 'add' ? 'wx' : 'w' });
  }
  for (const entry of plan.files) {
    if (sha256(await readRegular(plan.root, entry.path)) !== entry.patchedSha256) {
      fail(`written output SHA-256 mismatch: ${entry.path}`);
    }
  }
  return { id: 'rea-6.7.0/native-executable-verification', manifestSha256: plan.manifestSha256 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [root, mode, ...extra] = process.argv.slice(2);
    if (!root || extra.length || (mode !== undefined && mode !== '--check')) {
      throw new Error('Usage: node scripts/apply-rea-patches.mjs /path/to/exclusive/staging/rea [--check]');
    }
    if (mode === '--check') await prepareReaPatch(root);
    else await applyReaPatch(root);
    console.log(`REA 6.7.0 native executable patch ${mode === '--check' ? 'validated' : 'applied and verified'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
