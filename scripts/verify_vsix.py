"""Inspect a finished VSIX without trusting the working tree's packaging rules."""
import hashlib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

package = Path(sys.argv[1])
home_pattern = re.escape(str(Path.home()).encode()) + rb"(?:/|\\)"
allowed = re.compile(r'^(\[Content_Types\]\.xml|extension\.vsixmanifest|extension/(package\.json|readme\.md|LICENSE\.txt|LICENSE-REA|THIRD_PARTY_NOTICES\.txt|dist/(extension|browserServer|routerServer)\.js|media/[^/]+\.(js|css|svg)|docs/[^/]+\.md|runtime/(rea|node)/.+))$')
with zipfile.ZipFile(package) as archive:
    names = [item.filename for item in archive.infolist() if not item.is_dir()]
    assert len(names) == len(set(names)), 'Duplicate archive entries'
    for name in names:
        assert allowed.fullmatch(name), f'Unexpected distributed file: {name}'
        content = archive.read(name)
        # Scan for this build machine's actual home directory. Generic Windows
        # examples in upstream package comments (for example C:/Users/Will)
        # are not paths embedded for this extension's users.
        assert not re.search(home_pattern, content), f'Build-machine home path in {name}'
        assert not re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{80,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{35,}|sk-proj-[A-Za-z0-9_-]{40,}', content), f'Possible credential in {name}'
    required = ['package.json', 'readme.md', 'LICENSE.txt', 'LICENSE-REA', 'THIRD_PARTY_NOTICES.txt', 'dist/extension.js', 'dist/browserServer.js', 'dist/routerServer.js', 'media/rea.svg', 'media/sidebar.js', 'media/sidebarModel.js', 'media/sidebar.css', 'media/webAnalyzer.js', 'runtime/rea/scripts/rea.mjs', 'runtime/rea/LICENSE', 'runtime/rea/THIRD_PARTY_NOTICES.md', 'runtime/rea/licenses/README.md', 'runtime/rea/distribution.json']
    assert all('extension/' + name in names for name in required), 'Required package file missing'
    extension_bundle = archive.read('extension/dist/extension.js')
    analyzer_ui = archive.read('extension/media/webAnalyzer.js')
    mode_markers = {
        'Web Analysis': [b'target-web', b'analysis-results', b'analyze-target'],
        'GitHub Repository Analysis': [b'target-github', b'repository-results', b'analyzeGitHubRepository'],
        'macOS Desktop Application Analysis': [b'target-desktop', b'desktop-results', b'discoverDesktopApplications', b'inspectDesktop']
    }
    for mode, markers in mode_markers.items():
        assert all(marker in extension_bundle + analyzer_ui for marker in markers), f'{mode} implementation missing from VSIX'
    manifest = json.loads(archive.read('extension/package.json'))
    assert manifest['version'] == '0.4.0'
    identity = ET.fromstring(archive.read('extension.vsixmanifest')).find(
        '{http://schemas.microsoft.com/developer/vsx-schema/2011}Metadata/'
        '{http://schemas.microsoft.com/developer/vsx-schema/2011}Identity'
    )
    assert identity is not None and identity.attrib['Version'] == manifest['version'], 'VSIX version mismatch'
    assert manifest['main'] == './dist/extension.js'
    assert manifest['publisher'] == 'CAUCOLabs'
    engine_metadata = json.loads(archive.read('extension/runtime/rea/distribution.json'))
    assert engine_metadata['version'] == '6.7.0'
    node_files = [name for name in names if name.startswith('extension/runtime/node/')]
    targets = {name.split('/')[3] for name in node_files}
    assert len(targets) == 1, f'Expected one platform Node runtime, found {sorted(targets)}'
    target = next(iter(targets))
    assert target in {'darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'}, f'Unsupported VSIX target: {target}'
    assert identity.attrib.get('TargetPlatform') == target, 'VSIX target does not match bundled runtime'
    expected_platform, expected_arch = target.rsplit('-', 1)
    expected_platform = {'win32': 'win32'}.get(expected_platform, expected_platform)
    assert engine_metadata['platform'] == expected_platform and engine_metadata['arch'] == expected_arch, 'Engine dependency tree was prepared for a different platform'
    executable = 'node.exe' if target.startswith('win32-') else 'bin/node'
    assert f'extension/runtime/node/{target}/{executable}' in names, 'Bundled Node executable missing'
    assert f'extension/runtime/node/{target}/LICENSE' in names, 'Bundled Node license missing'
    assert f'extension/runtime/node/{target}/distribution.json' in names, 'Bundled Node metadata missing'
    runtime_metadata = json.loads(archive.read(f'extension/runtime/node/{target}/distribution.json'))
    assert runtime_metadata['target'] == target and runtime_metadata['version'] == '26.8.1'
    pty_arch = target.split('-', 1)[1]
    pty_os = {'darwin': 'darwin', 'win32': 'win32', 'linux': 'linux'}[target.split('-', 1)[0]]
    pty_native = f'extension/runtime/rea/node_modules/@lydell/node-pty-{pty_os}-{pty_arch}/'
    assert any(name.startswith(pty_native) and name.endswith(('.node', 'spawn-helper')) for name in names), f'Matching node-pty native dependency missing for {target}'
    assert not any('/node_modules/frida/' in name for name in names), 'Optional Frida package must not be bundled'
    if target == 'win32-x64':
        assert 'extension/runtime/rea/native/windows/build/rea-windows-x64.node' in names, 'Windows native control binary missing'
    else:
        assert not any('/runtime/rea/native/windows/' in name for name in names), 'Unneeded Windows native binary included for non-Windows target'
    notices = archive.read('extension/THIRD_PARTY_NOTICES.txt')
    assert b'@modelcontextprotocol/sdk' in notices and b'smol-toml' in notices
    assert b'Node.js 26.8.1' in notices, 'Bundled Node third-party notice missing'
    engine_files = sum(name.startswith('extension/runtime/rea/') for name in names)
    print(f'PASS: {package.resolve()} — target={target}, {len(names)} files ({engine_files} engine files), {package.stat().st_size} bytes')
    print('SHA256:', hashlib.sha256(package.read_bytes()).hexdigest())
    print('Archive checks only: no claim of GUI activation, exhaustive secret detection or platform compatibility.')
