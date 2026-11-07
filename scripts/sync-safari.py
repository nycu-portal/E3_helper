#!/usr/bin/env python3
"""Copy shared extension sources into the macOS and iPad Xcode projects."""
import hashlib
import json
import plistlib
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / 'safari/NYCU E3 Helper'
FILES = ['background.js', 'content.js', 'i18n.js', 'exam-detection.js', 'desktop-notifications.js', 'notification-api.js', 'notification-engine.js',
         'notification-settings.js', 'notification-settings.html',
         'notification-settings.css', 'jszip.min.js', '128.png', '_locales', 'CHANGELOG.md']
# Chrome PR #16 can merge before or after this Safari branch.
# Include its dependencies only when they exist in the merged source tree.
OPTIONAL_SIDEBAR_FILES = ['all-sites.js', 'all-sites-setting.js', 'all-sites-bootstrap.js',
                          'all-sites-panel.html', 'all-sites-panel.js', 'all-sites-panel.css']
FILES += [name for name in OPTIONAL_SIDEBAR_FILES if (ROOT / name).exists()]

def optional_resource_ids(name):
    return tuple(hashlib.sha256(f'e3-optional:{kind}:{name}'.encode()).hexdigest()[:24].upper()
                 for kind in ('file', 'build'))


def sync_optional_resource_entries(source):
    """Follow background.js into its group/build phase, preserving both project formats."""
    available = [name for name in OPTIONAL_SIDEBAR_FILES if (ROOT / name).exists()]
    if source.startswith('<?xml'):
        data = plistlib.loads(source.encode())
        objects = data['objects']
        background = next(key for key, obj in objects.items()
                          if obj.get('isa') == 'PBXFileReference' and obj.get('path') == 'Resources/background.js')
        background_build = next(key for key, obj in objects.items()
                                if obj.get('isa') == 'PBXBuildFile' and obj.get('fileRef') == background)
        group = next(obj for obj in objects.values() if background in obj.get('children', []))
        phase = next(obj for obj in objects.values() if background_build in obj.get('files', []))
        for name in OPTIONAL_SIDEBAR_FILES:
            file_id, build_id = optional_resource_ids(name)
            objects.pop(file_id, None); objects.pop(build_id, None)
            group['children'] = [key for key in group['children'] if key != file_id]
            phase['files'] = [key for key in phase['files'] if key != build_id]
            if name in available:
                objects[file_id] = dict(isa='PBXFileReference', path=f'Resources/{name}', name=name,
                                       sourceTree='<group>')
                objects[build_id] = dict(isa='PBXBuildFile', fileRef=file_id)
                group['children'].append(file_id); phase['files'].append(build_id)
        return plistlib.dumps(data, sort_keys=False).decode()

    # The macOS project uses OpenStep syntax. Insert beside the existing background
    # resource so the extension's group/phase is selected, never the host app's.
    for name in OPTIONAL_SIDEBAR_FILES:
        for key in optional_resource_ids(name):
            source = re.sub(r'^.*' + key + r'.*\n', '', source, flags=re.M)
    for name in available:
        file_id, build_id = optional_resource_ids(name)
        entries = [
            (r'^.* /\* background.js \*/ = \{isa = PBXFileReference;.*$',
             f'\t\t{file_id} /* {name} */ = {{isa = PBXFileReference; name = "{name}"; path = "Resources/{name}"; sourceTree = "<group>"; }};'),
            (r'^.* /\* background.js in Resources \*/ = \{isa = PBXBuildFile;.*$',
             f'\t\t{build_id} /* {name} in Resources */ = {{isa = PBXBuildFile; fileRef = {file_id} /* {name} */; }};'),
            (r'^\s*[A-F0-9]+ /\* background.js \*/,\s*$', f'\t\t\t\t{file_id} /* {name} */,'),
            (r'^\s*[A-F0-9]+ /\* background.js in Resources \*/,\s*$', f'\t\t\t\t{build_id} /* {name} in Resources */,')]
        for pattern, entry in entries:
            source, count = re.subn(pattern, lambda match: entry + '\n' + match[0], source, flags=re.M)
            if count != 1:
                raise ValueError(f'Expected one background resource anchor for {name}, found {count}')
    return source


def sync_project(project, extension, native_notifications):
    resources = project / extension / 'Resources'
    for name in OPTIONAL_SIDEBAR_FILES:
        if name not in FILES:
            (resources / name).unlink(missing_ok=True)
    for name in FILES:
        source, target = ROOT / name, resources / name
        if source.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    manifest['permissions'] = [p for p in manifest['permissions'] if p not in ('downloads', 'notifications')]
    if native_notifications:
        manifest['permissions'].append('nativeMessaging')
    manifest.pop('optional_permissions', None)
    manifest.pop('optional_host_permissions', None)
    manifest.pop('web_accessible_resources', None)
    manifest['options_ui'].pop('open_in_tab', None)
    # The AI providers use hosted APIs; no local Ollama service is needed.
    manifest['host_permissions'] = [p for p in manifest['host_permissions'] if 'localhost' not in p]
    (resources / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    pbx = next(project.glob('*.xcodeproj')) / 'project.pbxproj'
    source = sync_optional_resource_entries(pbx.read_text())
    pbx.write_text(source)
    if source.startswith('<?xml'):
        data = plistlib.loads(pbx.read_bytes())
        for obj in data['objects'].values():
            settings = obj.get('buildSettings', {})
            if 'MARKETING_VERSION' in settings:
                settings['MARKETING_VERSION'] = manifest['version']
        pbx.write_bytes(plistlib.dumps(data, sort_keys=False))
    else:
        source = re.sub(r'MARKETING_VERSION = [^;]+;', f"MARKETING_VERSION = {manifest['version']};", source)
        pbx.write_text(source)
    print(f"{project.name} resources synced: {manifest['version']}")

def sync():
    sync_project(PROJECT, 'NYCU E3 Helper Extension', True)
    ios = ROOT / 'safari/ios/NYCU E3 Helper iOS'
    if ios.exists():
        sync_project(ios, 'NYCU E3 Helper iOS Extension', False)

if __name__ == '__main__':
    sync()
