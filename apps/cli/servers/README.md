# servers/

Binarios de servidores MCP **de terceros**: Cualquier release ya
compilado que se haya descargado.

El contenido de esta carpeta está en `.gitignore` (salvo este archivo). Son artefactos de
cada máquina, pesan ~10 MB cada uno y no pertenecen al repositorio.

## Qué va aquí y qué no

| | |
|---|---|
| ✅ Binarios ya compilados | No hay build local que rehacer; copiarlos no crea desincronización |
| ❌ Servidores propios | Apunta al resultado del build para que un `go build` quede activo al instante. Una copia manual se queda vieja en silencio |
| ❌ Servidores que se lanzan con un comando | `npx`, `uvx` y `docker` se resuelven por `PATH`; no hay archivo que copiar |
| ❌ Servidores remotos | Van con `url` en la configuración, no con `command` |

## Cómo usarlos

1. Copia el binario aquí.
2. En Linux, macOS o WSL, dale permiso de ejecución:

   ```bash
   chmod +x servers/nombre-del-servidor
   ```

3. Agrégalo a `mcp.servers.json`. Las rutas se resuelven **respecto a ese archivo**, así que
   basta con `./servers/...`:

   ```json
   {
     "name": "servidor-de-tercero",
     "command": "./servers/tercero-mcp-server",
     "env": { "API_TOKEN": "${TOKEN_DE_TERCERO}" }
   }
   ```

Los secretos van en `.env` y se referencian con `${VARIABLE}`; nunca escritos en el JSON.

## Qué pedirle a quien te pasa un binario

- El compilado **para tu sistema operativo** (uno de Windows no corre en WSL, y viceversa).
- Los argumentos y variables de entorno que necesite.
- Los nombres de sus herramientas, para verificar que no choquen con las tuyas — si dos
  servidores declaran la misma, el CLI falla al arrancar en vez de elegir una en silencio.

## Nota sobre archivos generados

Un servidor puede escribir datos **junto a su binario**, es decir, aquí dentro. El nuestro
crea un `restaurant.db`. El `.gitignore` ya cubre esta carpeta y las bases SQLite, pero si
algún servidor genera otra cosa, verifica que no acabe en el repositorio.
