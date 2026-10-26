import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { validatePreparedRuntime } from './validate-runtime.mjs';
import { finalizeRuntime } from './finalize-runtime.mjs';
import { prepareReaSecurityDependencies, verifyReaSecurityDependencies } from './rea-security-dependencies.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetArg = process.argv.indexOf('--target');
const target = targetArg >= 0 ? process.argv[targetArg + 1] : `${process.platform}-${process.arch}`;
const targets = {
  'darwin-arm64': { platform: 'darwin', arch: 'arm64', ext: 'tar.gz', nodePath: ['bin', 'node'] },
  'darwin-x64': { platform: 'darwin', arch: 'x64', ext: 'tar.gz', nodePath: ['bin', 'node'] },
  'win32-x64': { platform: 'win32', arch: 'x64', nodeArch: 'win-x64', ext: 'zip', nodePath: ['node.exe'] },
  'linux-x64': { platform: 'linux', arch: 'x64', ext: 'tar.xz', nodePath: ['bin', 'node'] }
};
const spec = targets[target];
if (!spec) throw new Error(`Unsupported target ${target}. Choose one of ${Object.keys(targets).join(', ')}.`);
if (`${process.platform}-${process.arch}` !== target) throw new Error(`Native engine dependencies must be prepared on ${target}; this runner is ${process.platform}-${process.arch}.`);

const nodeVersion = process.env.NODE_RUNTIME_VERSION || '26.8.1';
const archiveName = `node-v${nodeVersion}-${spec.nodeArch || target}.${spec.ext}`;
const staging = await mkdtemp(path.join(root, '.runtime-build-'));
let completed = false;
try {
  const nodeBase = `https://nodejs.org/dist/v${nodeVersion}`;
  const sums = await (await fetch(`${nodeBase}/SHASUMS256.txt`)).text();
  const expected = new RegExp(`^([a-f0-9]{64})\\s+${archiveName.replaceAll('.', '\\.')}\\s*$`, 'm').exec(sums)?.[1];
  if (!expected) throw new Error(`Official Node checksums do not list ${archiveName}.`);
  const response = await fetch(`${nodeBase}/${archiveName}`);
  if (!response.ok || !response.body) throw new Error(`Node download failed: HTTP ${response.status}.`);
  const archive = path.join(staging, archiveName);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (actual !== expected) throw new Error(`Node archive checksum mismatch for ${archiveName}.`);

  const unpacked = path.join(staging, 'node');
  await mkdir(unpacked);
  execFileSync('tar', ['-xf', archive, '-C', unpacked], { stdio: 'inherit' });

  const npmCli = process.env.npm_execpath;
  const runNpm = (args, cwd = staging) => {
    if (npmCli) execFileSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit' });
    else if (process.platform === 'win32') execFileSync('npm.cmd', args, { cwd, stdio: 'inherit', shell: true });
    else execFileSync('npm', args, { cwd, stdio: 'inherit' });
  };
  runNpm(['pack', 'rea-agents@6.7.0', '--ignore-scripts', '--pack-destination', staging]);
  const packageArchive = path.join(staging, 'rea-agents-6.7.0.tgz');
  execFileSync('tar', ['-xzf', packageArchive, '-C', staging], { stdio: 'inherit' });
  const engineSource = path.join(staging, 'package');
  await prepareReaSecurityDependencies(engineSource);
  runNpm(['ci', '--omit=dev', '--include=optional', '--ignore-scripts'], engineSource);
  await verifyReaSecurityDependencies(engineSource);
  const stagedRea = path.join(staging, 'runtime', 'rea');
  execFileSync(
    process.execPath,
    [path.join(root, 'scripts', 'vendor-engine.mjs'), engineSource],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        REA_VENDOR_DESTINATION: stagedRea
      }
    }
  );

  // Fail the platform build if npm omitted the native optional binary for this runner.
  const { createRequire } = await import('node:module');
  createRequire(path.join(stagedRea, 'scripts', 'rea.mjs'))('@lydell/node-pty');

  const runtimeDirectory = path.join(staging, 'runtime', 'node', target);
  const nodeRoot = path.join(unpacked, `node-v${nodeVersion}-${spec.nodeArch || target}`);
  await mkdir(runtimeDirectory, { recursive: true });
  const executable = path.join(runtimeDirectory, ...spec.nodePath);
  await mkdir(path.dirname(executable), { recursive: true });
  await copyFile(path.join(nodeRoot, ...spec.nodePath), executable);
  await copyFile(path.join(nodeRoot, 'LICENSE'), path.join(runtimeDirectory, 'LICENSE'));
  if (process.platform !== 'win32') await chmod(executable, 0o755);
  const runtimeVersion = execFileSync(executable, ['-p', 'process.version'], { encoding: 'utf8' }).trim();
  if (runtimeVersion !== `v${nodeVersion}`) throw new Error(`Bundled runtime reports unexpected version ${runtimeVersion}.`);
    const executableSha256 = createHash('sha256')
      .update(await readFile(executable))
      .digest('hex');

  await writeFile(path.join(runtimeDirectory, 'distribution.json'), JSON.stringify({ version: nodeVersion, target, archive: archiveName, sha256: actual, executableSha256 }, null, 2) + '\n');
  console.log(`Prepared ${target}: Node ${runtimeVersion}; REA 6.7.0; @lydell/node-pty loaded.`);

    const stagedRuntime = path.join(staging, 'runtime');

    console.log('Validating staged runtime integrity...');

    const validation = await validatePreparedRuntime(
      stagedRuntime,
      target
    );

    console.log(
      `Validated ${validation.verifiedReaFiles} REA files; Node ${validation.nodeVersion}.`
    );

    const result = await finalizeRuntime({
      projectRoot: root,
      stagedRuntime,
      target,
      prepareOnly: process.env.REA_PREPARE_ONLY === '1',
      preservePreviousRuntime:
        process.env.REA_PRESERVE_PREVIOUS_RUNTIME === '1'
    });

    if (result.mode === 'candidate') {
      console.log(
        `Validated runtime candidate saved at ${result.candidatePath}`
      );

      console.log(
        'Prepare-only mode: active runtime was not replaced.'
      );
    } else {
      if (result.previousRuntimePreserved) {
        console.log(
          `Previous runtime preserved at ${result.backup}`
        );
      }

      if (result.cleanupPending) {
        console.warn(
          'Runtime published, but previous-runtime cleanup remains pending.'
        );
      }
    }

  completed = true;
} finally {
  if (completed) {
    await rm(staging, { recursive: true, force: true });
  } else {
    console.error(`Runtime preparation failed; staging preserved at ${staging}`);
  }
}
