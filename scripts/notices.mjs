import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// Only packages whose code is included in the bundles need redistribution notices.
export async function generateNotices(metafile) {
  const roots = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (match) roots.add(match[1]);
  }
  const sections = [];
  for (const root of [...roots].sort()) {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const licenses = (await readdir(root)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name)).sort();
    if (!licenses.length) throw new Error(`Missing license for bundled package ${pkg.name}`);
    const texts = await Promise.all(licenses.map(async name => `${name}\n${await readFile(path.join(root, name), 'utf8')}`));
    sections.push(`${pkg.name} ${pkg.version} (${pkg.license ?? 'see notice'})\n${texts.join('\n')}`);
  }
  try {
    for (const target of await readdir('runtime/node')) {
      const directory = path.join('runtime/node', target);
      const metadata = JSON.parse(await readFile(path.join(directory, 'distribution.json'), 'utf8'));
      sections.push(`Node.js ${metadata.version} (${target}) — MIT\n${await readFile(path.join(directory, 'LICENSE'), 'utf8')}`);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile('THIRD_PARTY_NOTICES.txt', `REA for VS Code — bundled dependency notices\nREA engine 6.7.0 is bundled under MIT; see LICENSE-REA and runtime/rea/THIRD_PARTY_NOTICES.md for engine and upstream notices. Platform Node.js runtime license is included below.\n\n${sections.join('\n\n----------------------------------------\n\n')}`);
}
