import { get } from 'node:https';
import { createHash } from 'node:crypto';

export const REPOSITORY_LIMITS = { entries: 20000, files: 24, fileBytes: 256 * 1024, totalBytes: 2 * 1024 * 1024, timeoutMs: 180000 } as const;
export interface RepositoryEntry { path: string; type: 'blob' | 'tree' | 'commit'; mode: string; sha: string; size?: number }
export interface RepositoryFile { path: string; gitSha: string; sha256: string; text: string }
export interface RepositorySnapshot {
  target: string; commit: string; tree: string; defaultBranch: string;
  entries: RepositoryEntry[]; files: RepositoryFile[]; limitations: string[];
}
export type GitHubRequest = (path: string, signal: AbortSignal, maxBytes: number) => Promise<unknown>;

export function githubRepositoryUrl(value: string) {
  // Check the raw path as well: URL normalizes dot segments before validation.
  if (value.length > 2048 || !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+(?:\/)?$/i.test(value)) {
    throw new Error('Enter a public repository URL such as https://github.com/owner/repository (no branch, query or credentials).');
  }
  const url = new URL(value);
  const [owner, rawRepo] = url.pathname.split('/').slice(1);
  const repo = rawRepo.replace(/\.git$/, '');
  if (!repo || repo === '.' || repo === '..' || repo.length > 100 || owner.length > 39) throw new Error('Invalid GitHub repository name.');
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

/** Fixed public GitHub origin, GET only, no credentials and no redirects. */
export const requestGitHub: GitHubRequest = (path, signal, maxBytes) => new Promise((resolve, reject) => {
  if (!/^\/repos\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+(?:\/|$)/.test(path)) return reject(new Error('Invalid GitHub API path.'));
  const request = get({ hostname: 'api.github.com', path, signal,
    headers: { 'User-Agent': 'REA-for-VS-Code/0.4.0', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  }, response => {
    const status = response.statusCode;
    if (status !== 200) {
      response.resume();
      reject(new Error(status === 404 ? 'Repository or revision not found. Only public repositories are supported.' :
        status === 403 || status === 429 ? 'GitHub request denied or public API rate limit reached. Retry later; authentication is not required.' :
        status === 409 ? 'The repository is empty or has no readable default revision.' :
        status && status >= 300 && status < 400 ? 'GitHub redirected this repository. Enter its current canonical URL.' : `GitHub request failed (HTTP ${status ?? 'unknown'}).`));
      return;
    }
    const chunks: Buffer[] = []; let bytes = 0;
    response.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { response.destroy(new Error('GitHub response exceeded the analysis size limit.')); return; }
      chunks.push(chunk);
    });
    response.on('error', reject);
    response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('GitHub returned invalid JSON.')); } });
  });
  const deadline = setTimeout(() => request.destroy(new Error('GitHub request timed out. Retry when the network is available.')), 20000);
  request.on('close', () => clearTimeout(deadline));
  request.on('error', error => reject(signal.aborted ? new Error('Repository analysis was cancelled or timed out.') : new Error(`GitHub retrieval failed: ${error.message}`)));
});

const record = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub returned an invalid repository response.');
  return value as Record<string, any>;
};
const sha = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) throw new Error('GitHub returned an invalid object identity.');
  return value;
};
export function portableRepositoryPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\\\x00-\x1f\x7f:]/.test(value) &&
    value.split('/').every(part => !!part && part !== '.' && part !== '..' && !/[. ]$/.test(part) &&
      !/^(?:\.git|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export const repositoryManifest = (path: string) => /(?:^|\/)(?:package\.json|composer\.json|Cargo\.toml|pyproject\.toml|requirements[^/]*\.txt|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|[^/]+\.csproj|Gemfile|Dockerfile|tsconfig\.json|(?:vite|next|webpack)\.config\.[cm]?[jt]s|(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock))$/.test(path);
const source = (path: string) => /\.(?:[cm]?js|jsx|tsx?|py|go|rs|java|cs|rb|php)$/.test(path);
const excluded = (path: string) => /(?:^|\/)(?:node_modules|vendor|dist|build|\.git)(?:\/|$)/.test(path);

export async function retrieveGitHubRepository(value: string, signal: AbortSignal, request: GitHubRequest = requestGitHub,
  progress: (message: string) => void = () => {}): Promise<RepositorySnapshot> {
  const target = githubRepositoryUrl(value);
  const base = `/repos/${target.owner}/${target.repo}`;
  const metadata = record(await request(base, signal, 512 * 1024));
  if (metadata.private !== false) throw new Error('Only public GitHub repositories are supported.');
  if (typeof metadata.default_branch !== 'string' || !metadata.default_branch) throw new Error('The repository has no default branch.');
  const head = record(await request(`${base}/commits/${encodeURIComponent(metadata.default_branch)}`, signal, 2 * 1024 * 1024));
  const commit = sha(head.sha), tree = sha(head.commit?.tree?.sha);
  progress(`Reading repository structure at ${commit.slice(0, 12)}…`);
  const inventory = record(await request(`${base}/git/trees/${tree}?recursive=1`, signal, 8 * 1024 * 1024));
  if (sha(inventory.sha) !== tree || !Array.isArray(inventory.tree)) throw new Error('GitHub tree identity did not match the pinned revision.');
  const limitations: string[] = [];
  if (inventory.truncated || inventory.tree.length > REPOSITORY_LIMITS.entries) limitations.push('Repository inventory is partial: GitHub truncation or the 20,000-entry limit was reached.');
  const entries: RepositoryEntry[] = []; const paths = new Set<string>();
  for (const candidate of inventory.tree.slice(0, REPOSITORY_LIMITS.entries)) {
    const item = record(candidate);
    if (!portableRepositoryPath(item.path) || paths.has(item.path.toLowerCase())) { limitations.push('An unsafe or case-colliding path was excluded.'); continue; }
    if (!['blob', 'tree', 'commit'].includes(item.type) || !['100644', '100755', '040000', '120000', '160000'].includes(item.mode)) throw new Error('GitHub returned an invalid tree entry.');
    paths.add(item.path.toLowerCase());
    entries.push({ path: item.path, type: item.type, mode: item.mode, sha: sha(item.sha), size: Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : undefined });
  }
  const candidates = entries.filter(e => e.type === 'blob' && ['100644', '100755'].includes(e.mode) && !excluded(e.path) && (repositoryManifest(e.path) || source(e.path) || /(?:^|\/)README\.md$/i.test(e.path)));
  const priority = (path: string) => {
    if (/^(?:test|tests|examples|fixtures|docs)(?:\/|$)/i.test(path)) return 8;
    if (path === 'package.json') return 0;
    if (!path.includes('/') && repositoryManifest(path) && !/lock/.test(path)) return 1;
    if (!path.includes('/') && /(?:index|main|app|server)\.[^.]+$/.test(path)) return 2;
    if (/^(?:src|lib|app|server)\//.test(path) && source(path)) return 3;
    if (repositoryManifest(path) && !/lock/.test(path)) return 4;
    if (/README\.md$/i.test(path)) return 5;
    return /lock/.test(path) ? 7 : 6;
  };
  candidates.sort((a, b) => priority(a.path) - priority(b.path) || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path, 'en'));
  const files: RepositoryFile[] = []; let total = 0, requests = 0;
  for (const item of candidates) {
    signal.throwIfAborted();
    if (requests >= REPOSITORY_LIMITS.files) break;
    if (item.size === undefined || item.size > REPOSITORY_LIMITS.fileBytes || total + item.size > REPOSITORY_LIMITS.totalBytes) continue;
    progress(`Reading ${item.path}…`);
    requests++;
    const blob = record(await request(`${base}/git/blobs/${item.sha}`, signal, 512 * 1024));
    if (sha(blob.sha) !== item.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string' || !/^[A-Za-z0-9+/=\r\n]*$/.test(blob.content)) throw new Error('GitHub returned an invalid file blob.');
    const bytes = Buffer.from(blob.content, 'base64');
    if (bytes.length !== item.size || bytes.length > REPOSITORY_LIMITS.fileBytes || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== item.sha) throw new Error('Repository file integrity verification failed.');
    total += bytes.length;
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { limitations.push(`Non-UTF-8 file not analyzed: ${item.path}`); continue; }
    if (text.includes('\0')) { limitations.push(`Binary file not analyzed: ${item.path}`); continue; }
    files.push({ path: item.path, gitSha: item.sha, sha256: createHash('sha256').update(bytes).digest('hex'), text });
  }
  limitations.push(`Bounded static snapshot: ${files.length} files read from ${entries.length} inventoried entries; at most 24 files, 256 KiB/file and 2 MiB total. Unread files, symlinks, submodules and LFS targets are not analyzed.`,
    'Dependency parsing covers package.json, pyproject.toml/Poetry, Cargo.toml, requirements.txt, go.mod and composer.json. Other captured configurations and lockfiles remain evidence for agent review; resolved transitive graphs are not claimed.',
    'Declared dependencies are not installed or vulnerability-audited. Build scripts, tests and application behavior are not executed.');
  return { target: target.url, commit, tree, defaultBranch: metadata.default_branch, entries, files, limitations: [...new Set(limitations)] };
}
