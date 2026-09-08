# restaurant-assistant

Host y cliente **MCP (Model Context Protocol)** para un asistente de restaurante,
implementados **desde cero y sin ningún SDK de MCP**: el cliente habla JSON-RPC 2.0 directamente
sobre stdio.

El asistente conversa en español, decide qué herramientas invocar y muestra en vivo cada
llamada al protocolo. El servidor MCP de recetas e inventario vive en un repositorio aparte:
[`restaurant-mcp-server`](../restaurant-mcp-server) (Go).

> 🇬🇧 *English version: [README.md](./README.md)*

---

## Índice

- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Puesta en marcha](#puesta-en-marcha)
- [Configurar servidores MCP](#configurar-servidores-mcp)
- [Usar el CLI](#usar-el-cli)
- [Casos de uso](#casos-de-uso)
- [Identidad y permisos](#identidad-y-permisos)
- [Proveedor LLM](#proveedor-llm)
- [Variables de entorno](#variables-de-entorno)
- [Desarrollo](#desarrollo)
- [Solución de problemas](#solución-de-problemas)
- [Seguridad](#seguridad)

---

## Arquitectura

```
apps/cli          Interfaz de terminal: REPL, colores, confirmaciones, archivo de servidores
apps/host         HostService: orquesta LLM + servidores MCP y lleva el registro unificado
packages/mcp-client     Cliente MCP: JSON-RPC 2.0, handshake, transporte stdio
packages/llm-provider   Interfaz LLMProvider + adaptador de Anthropic + doble para pruebas
packages/conversation   Ciclo de tool-calling, sesiones y confirmaciones
```

Las dependencias van en una sola dirección: `cli → host → conversation → llm-provider`, con
`mcp-client` conectado por el host. Tres decisiones sostienen esa forma:

**El LLM está detrás de una interfaz.** `LLMProvider` tiene un solo método relevante,
`complete()`. Cambiar de proveedor es construir otra implementación; nada más del sistema se
entera. El adaptador de Anthropic es el **único** archivo que conoce ese formato de mensajes.

**Los servidores MCP se combinan, no se acumulan.** `MultiServerToolRunner` presenta varios
servidores como un único catálogo de herramientas. Si dos declaran una herramienta con el
mismo nombre, **falla explícitamente** en vez de dejar que una gane en silencio: un conflicto
silencioso enviaría llamadas al servidor equivocado.

**La confirmación no es lo mismo que el permiso.** El CLI pregunta antes de una operación
sensible, pero el servidor valida el rol por su cuenta. El host es código cliente; un cliente
modificado podría no preguntar nada.

---

## Requisitos

- **Node.js 20+**
- **pnpm 11+** (`corepack enable` lo deja listo)
- El servidor MCP de Go ya compilado — ver su
  [README](../restaurant-mcp-server/README.md)
- *(Opcional)* Una API key de Anthropic. Sin ella el CLI funciona con un proveedor de
  demostración, suficiente para probar MCP de punta a punta sin costo ni conexión.

---

## Puesta en marcha

```bash
# 1. Compilar el servidor MCP (en el otro repositorio)
cd ../restaurant-mcp-server
go build -o bin/restaurant-mcp-server ./cmd/stdio

# 2. Instalar y compilar este proyecto
cd ../restaurant-assistant
pnpm install
pnpm build

# 3. Declarar el servidor MCP
cp apps/cli/mcp.servers.json.example apps/cli/mcp.servers.json
#    ...y ajusta "command" si tu ruta es distinta

# 4. (Opcional) Configurar la API key y el rol
cp apps/cli/.env.example apps/cli/.env

# 5. Arrancar
pnpm --filter @restaurant/cli start
```

> **Windows y WSL no se mezclan.** Elige uno y quédate ahí. Un binario Go compilado dentro de
> WSL es un ejecutable de Linux y `node.exe` de Windows no puede lanzarlo, aunque ambos vean
> el mismo disco.

---

## Configurar servidores MCP

La lista de servidores vive en **`apps/cli/mcp.servers.json`**. Agregar uno es editar JSON;
no hay que tocar código ni recompilar.

```json
{
  "servers": [
    {
      "name": "restaurant-local",
      "description": "Servidor MCP de recetas e inventario (Go).",
      "command": "../../../restaurant-mcp-server/bin/restaurant-mcp-server"
    },
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/ruta/a/exponer"]
    },
    {
      "name": "servidor-de-companero",
      "enabled": false,
      "command": "/ruta/al/binario",
      "env": { "API_TOKEN": "${TOKEN_DEL_COMPANERO}" }
    }
  ]
}
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `name` | sí | Único. Identifica al servidor en el registro y en `/servers`. |
| `command` | uno de los dos | Servidor local. Con `/` o `\` se resuelve **respecto al archivo**; sin separadores se busca en el `PATH` (`npx`, `uvx`, `docker`). |
| `url` | uno de los dos | Servidor remoto: el endpoint MCP completo, p. ej. `https://host/mcp`. |
| `headers` | no | Sólo remotos. Acá va el `Authorization: Bearer <token>`. |
| `args` | no | Arreglo de textos. |
| `env` | no | Variables extra para el subproceso. |
| `enabled` | no | `false` deja el servidor documentado pero apagado. |
| `description` | no | Sólo para quien lee el archivo. |

**Secretos.** Cualquier valor admite `${VARIABLE}`, que se sustituye desde el entorno al
arrancar. Si la variable no existe, el CLI **falla** en vez de pasar el texto crudo — así un
token faltante se detecta al inicio y no como un error confuso del servidor. Escribe los
secretos en `.env` (ignorado por git), nunca en el JSON.

**Rutas relativas al archivo, no al `cwd`.** El CLI se puede lanzar desde cualquier directorio;
anclar al archivo hace que la misma configuración funcione siempre.

`mcp.servers.json` está en `.gitignore` porque contiene rutas propias de cada máquina; la
plantilla versionada es `mcp.servers.json.example`.


### Conectarse a un servidor remoto

Una entrada lleva `command` (local, lanzado por stdio) o `url` (remoto, por HTTP), nunca
ambos:

```json
{
  "name": "restaurant-remoto",
  "url": "https://mi-servidor.ejemplo.com/mcp",
  "headers": { "Authorization": "Bearer ${MCP_REMOTE_TOKEN}" }
}
```

| Campo | Local (`command`) | Remoto (`url`) |
|---|---|---|
| `args`, `env` | ✅ | ❌ — no aplican |
| `headers` | ❌ — no aplican | ✅ — acá va el token |
| Identidad | La inyecta el host como `MCP_USER_ROLE` | La deriva el servidor del token |

**El host NO inyecta el rol a un servidor remoto, y es a propósito.** Un servidor remoto no
puede confiar en algo que elige el cliente: cualquiera que alcance el puerto podría decir que
es administrador. En su lugar deriva el rol del token. Mandar `MCP_USER_ROLE` por HTTP daría
la falsa impresión de que sirve para algo.

El CLI avisa cuando una `url` remota usa `http://` en vez de `https://`, porque el token
viajaría en claro. Avisa en vez de bloquear: entre dos laptops en la red del salón es una
elección legítima.

### De dónde sale la configuración

1. `--config ./archivo.json` o `MCP_CONFIG_FILE` — si se pide explícitamente y no existe, es un
   error, no un fallback silencioso.
2. `apps/cli/mcp.servers.json`.
3. `MCP_SERVER_BIN` — un único servidor, por compatibilidad con la configuración anterior.

```bash
pnpm --filter @restaurant/cli start -- --config ./demos/dos-servidores.json
```

---

## Usar el CLI

```
╭──────────────────────────────────────────────────────────╮
│ Asistente MCP de Restaurante                             │
│ Host + cliente MCP sobre JSON-RPC 2.0, sin SDK           │
╰──────────────────────────────────────────────────────────╯

sesión    diego · rol cook
modelo    claude-haiku-4-5
servidor  restaurant-local (mcp.servers.json)

Herramientas disponibles (5)
  • search_dishes
    Busca platillos del menú por nombre...
```

Cada llamada a una herramienta se muestra mientras ocurre:

```
⚙ get_recipe_details · restaurant-local (dishId=chocolate-cake)
✓ get_recipe_details listo

◆ asistente
  El Pastel de Chocolate lleva harina de trigo (gluten), chocolate amargo...
```

### Comandos

| Comando | Qué hace |
|---|---|
| `/tools` | Herramientas descubiertas, con sus parámetros y qué servidor las expone |
| `/servers` | Servidores conectados y cuántas herramientas aporta cada uno |
| `/log` | Registro unificado: mensajes MCP y eventos del ciclo de conversación |
| `/clear` | Limpia la pantalla sin perder el historial de la conversación |
| `/help` | Ayuda |
| `/exit` | Cierra la sesión (también `Ctrl+D`) |

**Color.** Se activa solo cuando la salida es una terminal. Se respeta `NO_COLOR=1` para
apagarlo y `FORCE_COLOR=1` para forzarlo. Los símbolos se degradan a ASCII si la terminal no
declara UTF-8, y redirigir a un archivo no deja códigos de escape sueltos.

---

## Casos de uso

### 1. Disponibilidad real, no una suposición

```
▸ tú › ¿puedo vender dos hamburguesas especiales?

⚙ get_dish_availability · restaurant-local (dishId=special-burger, servings=2)
✓ get_dish_availability listo

◆ asistente
  No alcanza. Con el inventario actual sólo se puede preparar 0 porciones:
  hacen falta 160 g de queso cheddar y sólo hay 40 g.
```

El asistente no calcula nada: el servidor devuelve el máximo posible y el ingrediente que lo
limita.

### 2. Alérgenos, sin inventar

```
▸ tú › ¿el pastel de chocolate lleva gluten?
```

La respuesta sale de `get_recipe_details`, que devuelve los alérgenos **registrados**. El
prompt del sistema prohíbe deducirlos: en una consulta sobre alergias, una respuesta inventada
es un riesgo real.

### 3. Ajustar inventario, con confirmación

```
▸ tú › se dañó queso, descuenta 10 gramos

╭ ▲ Operación sensible ─────────────────────────────────────╮
│ Se requiere tu confirmación — esta operación modifica datos│
│                                                            │
│   herramienta      adjust_inventory                        │
│   ingredientId     cheese                                  │
│   operation        subtract                                │
│   quantity         10                                      │
│   idempotencyKey   cli-demo-1788732710842-rmeamj                │
╰────────────────────────────────────────────────────────────╯

¿Confirmas? [s/N] s
✓ Operación confirmada.
```

Sólo un «sí» explícito aprueba: Enter en blanco, cualquier otra cosa o EOF cancelan. La
`idempotencyKey` hace que un reintento no vuelva a descontar.

### 4. Un permiso denegado, explicado

Con `MCP_USER_ROLE=waiter`, la misma operación se confirma en la interfaz y **aun así** el
servidor la rechaza. El asistente lo explica en lugar de fallar:

```
◆ asistente
  No tengo autorización para ajustar inventario con tu rol actual. Sólo cocina
  (cook) o administración (admin) pueden hacerlo.
```

### 5. Varios servidores a la vez

Con más de un servidor habilitado, `/servers` muestra qué herramienta aporta cada uno y las
llamadas en vivo indican el origen (`⚙ read_file · filesystem`). El host las presenta al modelo
como un solo catálogo.

---

## Identidad y permisos

El CLI **transporta** el rol; el servidor lo **valida**.

| Rol | Leer | Ajustar inventario |
|---|---|---|
| `waiter` (por defecto) | ✅ | ❌ |
| `cook` | ✅ | ✅ |
| `admin` | ✅ | ✅ |

```bash
# apps/cli/.env
MCP_USER_ROLE=cook
MCP_USER_ID=diego
```

Con stdio el servidor es un subproceso, así que la identidad viaja por entorno. El host la
inyecta en **todos** los servidores configurados: es el host quien declara en nombre de quién
actúa, no cada entrada del archivo.

Un rol no reconocido no escala privilegios — el servidor lo degrada a `waiter` — y el CLI lo
marca en rojo al arrancar para que se note antes de intentar la operación.

---

## Proveedor LLM

Por defecto se usa **`claude-haiku-4-5`**, el modelo más barato de la familia actual. Alcanza
de sobra: el modelo decide qué herramienta llamar, pero no calcula nada — de eso se encarga el
dominio en Go.

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5   # opcional
```

Los identificadores llevan **guiones, no puntos**: `claude-haiku-4-5`, no `claude-haiku-4.5`.
Uno mal escrito produce un `404 not_found_error` al enviar el primer mensaje.

**Sin API key** el CLI usa `HeuristicDemoProvider`, que reconoce intenciones por palabras clave
y llama a las herramientas de verdad. Sirve para demostrar todo el flujo MCP sin costo ni
conexión.

---

## Variables de entorno

Todas son opcionales y se leen de `apps/cli/.env` (ignorado por git) o del shell.

| Variable | Por defecto | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Sin ella se usa el proveedor de demostración |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` | Modelo a usar |
| `MCP_USER_ROLE` | `waiter` | Rol transportado a los servidores |
| `MCP_USER_ID` | `unspecified` | Queda en la auditoría de cada ajuste |
| `MCP_CONFIG_FILE` | — | Otro archivo de servidores |
| `MCP_SERVER_BIN` | — | Servidor único, si no hay archivo de configuración |
| `MCP_SERVER_ARGS` | — | Argumentos para ese servidor único |
| `HOST_MAX_ITERATIONS` | `8` | Tope de vueltas del ciclo tool-calling por turno |
| `NO_COLOR` / `FORCE_COLOR` | — | Apagar o forzar el color |

---

## Desarrollo

```bash
pnpm build       # compila todos los paquetes
pnpm test        # ejecuta todas las pruebas
pnpm typecheck   # verificación de tipos sin emitir
```

Las pruebas no tocan la red ni necesitan una API key: el adaptador de Anthropic recibe su
función de creación de mensajes por inyección, y el cliente MCP se prueba contra un transporte
de mentira.

---

## Solución de problemas

**`spawn ENOENT` / error `-4058`.** Node no encontró el binario del servidor. Casi siempre es
una de tres: no está compilado, la ruta en `mcp.servers.json` es incorrecta, o está compilado
para otro sistema operativo (el caso Windows/WSL). El CLI verifica el binario **antes** de
lanzarlo y el mensaje dice cuál servidor falló y respecto a qué directorio se resolvió la ruta.

**`404 not_found_error` con el nombre del modelo.** El identificador está mal escrito. Revisa
que lleve guiones y no puntos.

**`400 ... does not support the fallbacks parameter`.** Ese parámetro sólo lo aceptan los
modelos más nuevos. Está desactivado por defecto; si lo activaste, apágalo.

**El CLI arranca en modo demostración sin que lo pidieras.** No se encontró `ANTHROPIC_API_KEY`.
Verifica que `apps/cli/.env` exista y que la línea no tenga espacios alrededor del `=`.

**Cambios en el servidor Go que no se ven.** Go compila a un binario: hay que volver a ejecutar
`go build` para que el CLI use el código nuevo.

---

## Seguridad

- **Los permisos se validan en el servidor.** La confirmación del CLI es una capa adicional, no
  un sustituto.
- **Las operaciones sensibles requieren confirmación explícita**, y sólo un «sí» aprueba.
- **Los secretos nunca van al repositorio.** `.env` y `mcp.servers.json` están en `.gitignore`;
  el JSON referencia credenciales con `${VARIABLE}` en lugar de contenerlas.
- **Las credenciales no se registran.** El log de la sesión no incluye la API key ni el
  contenido de las variables de entorno.
- **Si una credencial se expone accidentalmente, rótala.** Aunque se borre después, hay que
  asumir que quedó comprometida.
