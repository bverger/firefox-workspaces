# Ficha en addons.mozilla.org

Textos para copiar en el formulario de AMO al publicar la primera versión *listed*.

## Nombre

Sidespace

## Resumen (máx. 250 caracteres)

**en-US:** Vertical tabs in the sidebar with workspaces, pinned tabs, nested folders and Today tabs that archive themselves. Swipe between workspaces and sync everything with your Firefox account.

**es:** Pestañas verticales en la barra lateral con workspaces, pestañas fijadas, carpetas anidadas y pestañas de Hoy que se archivan solas. Cambia de workspace deslizando y sincronízalo todo con tu cuenta de Firefox.

## Descripción (en-US)

Sidespace turns the sidebar into your tab list, organised the way modern sidebar browsers do it:

- **Workspaces** (Personal, Work, …): each window shows only the tabs of the current workspace. Switch with a click, a two-finger swipe on the sidebar, or Ctrl+1…5.
- **Favorites**: an icon grid at the top of each workspace.
- **Pinned tabs and nested folders**: saved tabs that stay when you close them. Click to reopen.
- **Today**: everything else. Tabs you haven't used for 12 hours (configurable, or never) are archived and can be reopened from the Archive.
- **Command bar** for new tabs (Ctrl+T on Mac / Alt+T): open tabs, bookmarks and history suggestions, or search with your default engine.
- **Search** across all workspaces, drag & drop to reorder, move tabs between workspaces and folders.
- **Sync**: workspaces, favorites, pinned tabs and folders sync through your Firefox account (Settings → Sync → Add-ons).

Optional: a userChrome.css in the project repository hides the horizontal tab bar and makes the sidebar auto-hide until the cursor reaches the screen edge (toggle button in the sidebar).

The interface is in Spanish for now.

## Descripción (es)

Sidespace convierte la barra lateral en tu lista de pestañas:

- **Workspaces** (Personal, Work…): cada ventana muestra solo las pestañas del workspace actual. Cambia con un clic, deslizando con dos dedos sobre la barra lateral o con Ctrl+1…5.
- **Favoritos**: cuadrícula de iconos arriba de cada workspace.
- **Fijadas y carpetas anidadas**: pestañas guardadas que se quedan aunque las cierres. Un clic las vuelve a abrir.
- **Hoy**: el resto. Las pestañas que no usas en 12 horas (configurable, o nunca) se archivan y se pueden recuperar desde *Archivadas*.
- **Barra de comandos** para abrir pestañas (Ctrl+T en Mac / Alt+T): sugerencias de pestañas abiertas, marcadores e historial, o búsqueda con tu buscador.
- **Buscador** en todos los workspaces, arrastrar y soltar para ordenar y mover pestañas entre workspaces y carpetas.
- **Sincronización**: workspaces, favoritos, fijadas y carpetas se sincronizan con tu cuenta de Firefox (Ajustes → Sincronización → Complementos).

Opcional: con el `userChrome.css` del repositorio se oculta la barra de pestañas de arriba y la barra lateral se esconde hasta que acercas el cursor al borde.

## Categoría

Tabs

## Etiquetas

tabs, vertical tabs, sidebar, workspaces, tab management

## Licencia

MIT

## Página web / código fuente

https://github.com/bverger/firefox-workspaces

## Política de privacidad

No hace falta: la extensión no recoge ni envía datos (`data_collection_permissions: none`). Todo se guarda en el almacenamiento de la extensión y, si el usuario lo activa, en Firefox Sync.

## Notas para los revisores (en-US)

No build step: the uploaded files are the source. Permissions:

- `tabs`, `tabHide`: list the tabs in the sidebar and hide the tabs of other workspaces.
- `sessions`: remember which workspace / folder each tab belongs to (session values).
- `storage`: workspaces, favorites and folders (storage.sync) and per-device state (storage.local).
- `menus`, `menus.overrideContext`: "Move to workspace / folder" items and the native tab context menu on sidebar items.
- `alarms`: periodic auto-archive of unused Today tabs.
- `history`, `bookmarks`, `search`: suggestions in the new-tab command bar (popup) and searching with the default engine. Nothing leaves the browser.

No remote code, no data collection. The only network requests are `<img>` loads of a site's own `/favicon.ico`, for saved tabs whose icon this device hasn't cached yet; no third-party services.
