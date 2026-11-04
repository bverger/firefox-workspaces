#!/usr/bin/env python3
"""Exports Arc's spaces, pinned tabs and folders for the Workspaces extension.

Usage: python3 tools/arc-export.py [StorableSidebar.json] [-o arc-import.json]

Reads Arc's sidebar file (by default from ~/Library/Application Support/Arc)
and writes a JSON file to load with the extension's "Importar" button. Only
pinned tabs, folders and favorites are exported; Today tabs are not.
"""
import argparse
import json
import os
import sys

DEFAULT_SOURCE = os.path.expanduser('~/Library/Application Support/Arc/StorableSidebar.json')


def pairs_to_objects(values):
    # Arc stores lists as [id, object, id, object, ...].
    return [v for v in values if isinstance(v, dict)]


def to_hex(color):
    channel = lambda k: max(0, min(255, round(color.get(k, 0) * 255)))
    return '#{:02x}{:02x}{:02x}'.format(channel('red'), channel('green'), channel('blue'))


def space_color(space):
    palette = space.get('customInfo', {}).get('windowTheme', {}).get('primaryColorPalette', {})
    color = palette.get('midTone')
    return to_hex(color) if color else None


def export_entries(items, item_id):
    """Children of an Arc container/folder as Workspaces entries."""
    entries = []
    for child_id in items.get(item_id, {}).get('childrenIds', []):
        child = items.get(child_id)
        if not child:
            continue
        kind = next(iter(child.get('data', {})), None)
        if kind == 'tab':
            tab = child['data']['tab']
            url = tab.get('savedURL')
            if url and url.startswith(('http://', 'https://')):
                entries.append({'title': child.get('title') or tab.get('savedTitle') or url, 'url': url})
        elif kind == 'list':
            entries.append({'name': child.get('title') or 'Carpeta', 'children': export_entries(items, child_id)})
        else:
            # Split views and other groupings: keep their tabs in place.
            entries.extend(export_entries(items, child_id))
    return entries


def count(entries):
    tabs = folders = 0
    for e in entries:
        if 'children' in e:
            folders += 1
            t, f = count(e['children'])
            tabs, folders = tabs + t, folders + f
        else:
            tabs += 1
    return tabs, folders


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('source', nargs='?', default=DEFAULT_SOURCE)
    parser.add_argument('-o', '--output', default='arc-import.json')
    args = parser.parse_args()

    with open(args.source, encoding='utf-8') as f:
        data = json.load(f)
    container = next(c for c in data['sidebar']['containers'] if 'spaces' in c)
    items = {i['id']: i for i in pairs_to_objects(container['items'])}

    workspaces = []
    for space in pairs_to_objects(container['spaces']):
        ids = space.get('containerIDs', [])
        pinned = ids[ids.index('pinned') + 1] if 'pinned' in ids else None
        workspaces.append({
            'name': space.get('title') or 'Arc',
            'emoji': space.get('customInfo', {}).get('iconType', {}).get('emoji_v2'),
            'color': space_color(space),
            'pinned': export_entries(items, pinned) if pinned else [],
        })

    # Favorites (top apps) are shared by every space in Arc; give them to all.
    favorites = []
    top = container.get('topAppsContainerIDs', [])
    for i, value in enumerate(top):
        if isinstance(value, str) and value in items:
            favorites += [e for e in export_entries(items, value) if 'url' in e]
    for ws in workspaces:
        ws['favorites'] = favorites

    result = {'source': 'arc', 'version': 1, 'workspaces': workspaces}
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)

    for ws in workspaces:
        tabs, folders = count(ws['pinned'])
        print(f"{ws['name']}: {tabs} fijadas, {folders} carpetas, {len(ws['favorites'])} favoritos")
    size = len(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode())
    print(f'Escrito {args.output} ({size / 1024:.0f} KB)', file=sys.stderr)


if __name__ == '__main__':
    main()
