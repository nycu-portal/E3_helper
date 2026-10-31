const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
test('Safari sync packages optional assets in both Xcode graphs across merge orders', () => {
  execFileSync('python3', ['-c', `
import hashlib, importlib.util, json, plistlib, re, shutil, sys, tempfile
from pathlib import Path
source = Path(sys.argv[1])
def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result
original = module(source/'scripts/sync-safari.py', 'original')
projects = [source/'safari/NYCU E3 Helper', source/'safari/ios/NYCU E3 Helper iOS']
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory); (root/'scripts').mkdir()
    shutil.copy2(source/'scripts/sync-safari.py', root/'scripts/sync-safari.py')
    for name in original.FILES:
        if name in original.OPTIONAL_SIDEBAR_FILES: continue
        item = source/name
        if item.is_dir(): shutil.copytree(item, root/name)
        else: shutil.copy2(item, root/name)
    manifest = json.loads((source/'manifest.json').read_text())
    manifest.update(optional_permissions=['scripting'], optional_host_permissions=['https://*/*'], web_accessible_resources=[{'resources':['all-sites-panel.html'], 'matches':['https://*/*']}])
    (root/'manifest.json').write_text(json.dumps(manifest))
    for index, template in enumerate(projects):
        project = root/str(index); extension = 'NYCU E3 Helper' + (' iOS' if index else '') + ' Extension'
        (project/extension/'Resources').mkdir(parents=True)
        pbx = project/'Fixture.xcodeproj/project.pbxproj'; pbx.parent.mkdir()
        shutil.copy2(next(template.glob('*.xcodeproj'))/'project.pbxproj', pbx)
        for available in [False, True, True, False]:
            for name in original.OPTIONAL_SIDEBAR_FILES:
                if available: (root/name).write_text('// fixture')
                else: (root/name).unlink(missing_ok=True)
            fixture = module(root/'scripts/sync-safari.py', 'fixture')
            fixture.sync_project(project, extension, index == 0)
            resources = project/extension/'Resources'
            output = json.loads((resources/'manifest.json').read_text())
            for key in ['optional_permissions', 'optional_host_permissions', 'web_accessible_resources']: assert key not in output
            text = pbx.read_text()
            for name in original.OPTIONAL_SIDEBAR_FILES:
                assert (resources/name).exists() == available
                # IDs must be reachable from a build phase and a group, not just declared.
                file_id, build_id = [hashlib.sha256(f'e3-optional:{kind}:{name}'.encode()).hexdigest()[:24].upper() for kind in ('file', 'build')]
                if text.startswith('<?xml'):
                    objects = plistlib.loads(pbx.read_bytes())['objects']
                    assert (file_id in objects) == available
                    assert (build_id in objects) == available
                    if available:
                        assert objects[build_id]['fileRef'] == file_id
                        assert any(build_id in obj.get('files', []) and obj['isa'] == 'PBXResourcesBuildPhase' for obj in objects.values())
                        assert any(file_id in obj.get('children', []) for obj in objects.values())
                else:
                    assert text.count(file_id) == (3 if available else 0)
                    assert text.count(build_id) == (2 if available else 0)
                    if available:
                        phases = text.split('/* Begin PBXResourcesBuildPhase section */')[1].split('/* End PBXResourcesBuildPhase section */')[0]
                        assert build_id in phases
                        groups = text.split('/* Begin PBXGroup section */')[1].split('/* End PBXGroup section */')[0]
                        assert file_id in groups
            before = pbx.read_bytes()
            fixture.sync_project(project, extension, index == 0)
            assert pbx.read_bytes() == before, 'sync must be idempotent'
`, path.join(__dirname, '..')], { stdio: 'pipe' });
});
