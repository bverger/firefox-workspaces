# Sidespace (extensión para Firefox)

Pestañas verticales en la barra lateral, con workspaces al estilo Arc/Dia.

- **Workspaces** (Personal, Work y los que quieras): al cambiar de uno a otro, se ocultan las pestañas de los demás, también en la barra de pestañas nativa. Todos comparten cookies y sesiones; es una agrupación visual.
- **Cambiar de workspace**:
  - clic en el workspace, arriba de la barra lateral;
  - deslizar con dos dedos a izquierda o derecha sobre la barra lateral (o Shift + rueda del ratón);
  - `Ctrl+1` … `Ctrl+5` en Mac (`Alt+1` … `Alt+5` en Windows/Linux).
La barra lateral se organiza como en Arc, de arriba abajo:

- **Favoritos**: cuadrícula de iconos. Arrastra una pestaña ahí, o usa clic derecho → *Añadir a favoritos del workspace*. Las pestañas fijadas de Firefox aparecen con borde discontinuo y se ven en todos los workspaces.
- **Fijadas**: pestañas que se conservan. Arrastra una pestaña a esta zona, o usa clic derecho → *Fijar en el workspace*. Si cierras la pestaña, el elemento sigue ahí atenuado y al hacer clic se vuelve a abrir. El botón *−* la desfija. Si pasa el tiempo de archivado sin usarla, solo se descarga de memoria; no se cierra.
- **Carpetas** (dentro de *Fijadas*, mezcladas con las pestañas como en Arc): crea una con *+ Carpeta*, o una subcarpeta con el *+* que aparece al pasar por encima de una carpeta. Doble clic o clic derecho para renombrarla, y clic para plegarla. Arrastra pestañas o carpetas dentro, o usa clic derecho → *Mover a carpeta*. Su contenido funciona igual que las fijadas. Borrar una carpeta borra también lo que contiene.
- **Hoy**: pestañas temporales. Las que llevan un tiempo sin usarse se cierran solas y pasan a *Archivadas*. El tiempo se elige abajo del todo: 12 horas (por defecto, como Arc), 24 horas, 7 días, 30 días o nunca. *Limpiar* archiva ya todas las de Hoy del workspace. No se archivan la pestaña seleccionada ni las que están reproduciendo sonido. Si arrastras una fijada aquí, vuelve a ser temporal.
- **Archivadas**: las últimas 50 pestañas archivadas; las de más de 30 días se borran solas. Haz clic en una para volver a abrirla. Este archivo es de cada PC y no se sincroniza.

- **Nueva pestaña**, como en Arc: *+ Nueva pestaña* en el panel, el icono de la extensión o `Ctrl+T` en Mac (`Alt+T` en Windows/Linux) abren una barra con un solo campo. Sugiere pestañas abiertas, marcadores e historial de los últimos 90 días, con las páginas más visitadas primero. Si lo que escribes es el principio de un dominio que has visitado (`x.`, `you`), la primera sugerencia es esa web, no sus páginas. Enter abre la URL o busca con tu buscador predeterminado, y con el campo vacío abre una pestaña en blanco. Firefox no deja que una extensión use `Cmd+T`; puedes probar a asignarle otro atajo en *Gestionar atajos de extensiones*.
- **Buscador**: filtra las pestañas de todos los workspaces. Las de otros workspaces aparecen con un punto de color; al hacer clic en una, cambias a su workspace. Enter abre el primer resultado y Esc limpia la búsqueda.
- **Gestión de pestañas**: arrastra para reordenar, suelta una pestaña sobre un workspace para moverla, clic central para cerrarla y clic derecho para abrir el menú nativo de la pestaña (incluye *Mover a workspace*).
- **Editar un workspace**: doble clic o clic derecho sobre él para cambiar nombre y color, o para eliminarlo. Si lo eliminas, sus pestañas pasan al primer workspace.

## Importar desde Arc

```bash
python3 tools/arc-export.py
```

Lee `~/Library/Application Support/Arc/StorableSidebar.json` y crea `arc-import.json` con tus espacios, pestañas fijadas, carpetas y subcarpetas (no las pestañas de Hoy). Después, en la barra lateral, pulsa *Importar…* abajo del todo y elige ese archivo. Cada espacio de Arc se une al workspace del mismo nombre, o se crea uno nuevo, con su emoji y su color. Después de importar, el botón desaparece en todos tus PCs (la marca se sincroniza), así que no se puede importar dos veces por error.

Las pestañas importadas muestran el `/favicon.ico` de su web hasta que las abres por primera vez; a partir de ahí, el icono que use la página.

## Probar cambios antes de publicarlos

```sh
tools/dev.sh
```

Abre un Firefox de pruebas aparte, con la extensión cargada desde esta carpeta. Funciona a la vez que tu Firefox normal, y con Ctrl+C en la terminal se cierra.

- **Perfil propio** (`~/.sidespace-dev/profile`), que se conserva entre ejecuciones. Importa `arc-import.json` la primera vez y ahí se queda.
- **Sin cuenta de Firefox:** las cuentas están desactivadas en ese perfil, así que un cambio con errores nunca llega a los datos que Firefox Sync lleva a tus PCs.
- **Recarga sola:** al guardar cualquier archivo de la extensión, se recarga. Los cambios de `userchrome/` se copian al arrancar, así que para verlos hay que volver a lanzar el script.

No uses *Cargar complemento temporal* de `about:debugging` en tu Firefox normal. Tiene el mismo ID que la versión de AMO, así que la sustituye mientras está cargada y escribe en tus datos sincronizados reales.

Para empezar de cero: `rm -rf ~/.sidespace-dev`.

## Instalarla y actualizarla

La extensión se publica en addons.mozilla.org (*listed*). Se instala desde su página de la tienda y Firefox la actualiza solo. En cada PC con tu cuenta de Firefox (y *Complementos* activado en la sincronización), Firefox Sync la instala sin hacer nada.

**Publicar una versión nueva.** No hay que hacer nada: cada push a `main` que cambie archivos de la extensión (`manifest.json`, `*.js`, `sidebar/`, `popup/`, `icons/`) lo publica GitHub Actions ([.github/workflows/publish.yml](.github/workflows/publish.yml)). El workflow sube la versión (patch) a partir de la última etiqueta `vX.Y.Z`, la pasa por el lint, la envía a revisión en AMO y después hace commit del nuevo número en `main` y crea la etiqueta. Cuando Mozilla la aprueba, Firefox la instala en tus PCs en menos de un día; para no esperar: `about:addons` → ⚙️ → *Buscar actualizaciones*.

- Cambios en el README, `tools/`, `store/` o `userchrome/` no publican nada.
- Para no publicar un commit concreto, pon `[no release]` en su mensaje.
- Para un salto de versión mayor (por ejemplo 0.2.0), cambia el número en `manifest.json`; el workflow usa el del manifest si es mayor que la última etiqueta.
- Las claves de AMO (*Tools → Manage API Keys*) están guardadas como *secrets* del repositorio (`WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET`). Para cambiarlas:

  ```bash
  gh secret set WEB_EXT_API_KEY --repo bverger/firefox-workspaces
  gh secret set WEB_EXT_API_SECRET --repo bverger/firefox-workspaces
  ```

Si una publicación falla, el motivo está en la pestaña *Actions* del repositorio.

Los textos de la ficha de la tienda están en [store/amo-listing.md](store/amo-listing.md).

Antes de instalarla en un ordenador de empresa, comprueba en `about:policies` que la organización no bloquea extensiones fuera de una lista permitida (`ExtensionSettings`).

## Ocultar la barra de pestañas de arriba

Una extensión no puede tocar la interfaz de Firefox, así que se hace con un `userChrome.css` ([userchrome/userChrome.css](userchrome/userChrome.css)): oculta la barra de pestañas y la cabecera de la barra lateral. Para instalarlo en tu perfil por defecto, con Firefox cerrado:

```bash
./userchrome/install.sh
```

El mismo CSS permite que el panel se oculte solo y aparezca al acercar el cursor al borde izquierdo, como en Arc. Se activa y desactiva con el botón de arriba a la derecha del panel (o con un atajo que puedes asignar en *Gestionar atajos de extensiones*). La preferencia se sincroniza entre PCs. El ancho del panel desplegado está en `--ws-expanded` dentro de [userchrome/autohide-sidebar.css](userchrome/autohide-sidebar.css).

Una extensión no puede cambiar el CSS de Firefox, así que el botón añade una marca invisible al título del panel, y el CSS solo oculta el panel cuando ve esa marca. Sin el `userChrome.css` instalado, el botón no hace nada.

El script copia el CSS en `chrome/` del perfil, junto con el que oculta la columna de iconos del panel lateral de Firefox, (guarda una copia si ya tenías uno) y añade a `user.js` dos ajustes: activar `userChrome.css` y mostrar la barra de título nativa, porque en macOS los botones de la ventana estaban en la barra de pestañas. Para deshacerlo, borra `chrome/userChrome.css` y esas dos líneas de `user.js`.

No actives a la vez las pestañas verticales nativas de Firefox, o tendrás dos listas de pestañas.

## Usarla en varios ordenadores

Inicia sesión con la misma cuenta de Firefox en todos los PCs y deja activado *Complementos* en *Ajustes → Sincronización*.

| Qué | ¿Se sincroniza? |
|---|---|
| Workspaces: nombres, colores, orden | Sí, lo hace la extensión con `storage.sync` |
| Favoritos, fijadas y carpetas de cada workspace | Sí, lo hace la extensión |
| Tiempo de archivado | Sí |
| Pestañas archivadas | No, son de cada PC |
| Marcadores, historial, contraseñas, ajustes | Sí, lo hace Firefox Sync |
| Pestañas abiertas en cada workspace | No: cada PC tiene las suyas. Las de los otros dispositivos se ven en Firefox View |
| La propia extensión | Sí: Firefox Sync la instala en tus otros PCs y AMO la mantiene actualizada |
| `userChrome.css` | No: ejecuta `userchrome/install.sh` en cada PC |

Firefox Sync tarda unos minutos en propagar los cambios. Si editas el mismo workspace en dos PCs a la vez, se queda la última versión. Cada workspace admite unos 30–40 favoritos, y cada carpeta unos 30–40 elementos (límite de 8 KB por elemento de `storage.sync`, 100 KB en total).

## Notas

- La primera vez que la extensión oculta pestañas, Firefox muestra un aviso. Es normal. Si desactivas la extensión, todas las pestañas vuelven a verse.
- Los atajos se cambian en `about:addons` → ⚙️ → *Gestionar atajos de extensiones*. *Workspace siguiente/anterior* no tienen atajo por defecto. Si en macOS tienes activado `Ctrl+número` para cambiar de escritorio (Mission Control), cambia uno de los dos.
- Las pestañas ocultas siguen cargadas en memoria. Firefox las descarga solo si le falta memoria.
- Al instalar la extensión, las pestañas que ya tenías abiertas van al workspace *Personal*.
