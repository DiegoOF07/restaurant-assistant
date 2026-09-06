# restaurant-assistant

An **MCP (Model Context Protocol)** host and client for a restaurant assistant, implemented
**from scratch with no MCP SDK**: the client speaks JSON-RPC 2.0 directly over stdio.

The assistant converses in Spanish, decides which tools to invoke, and shows every protocol
call live. The recipe and inventory MCP server lives in a separate repository:
[`restaurant-mcp-server`](../restaurant-mcp-server) (Go).


> 🇪🇸 *Versión en español: [README.es.md](./README.es.md)*
>
> Note: the assistant's user-facing strings are in **Spanish** by design.

---

## Table of contents

- [Architecture](#architecture)
- [Implemented features](#implemented-features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuring MCP servers](#configuring-mcp-servers)
- [Using the CLI](#using-the-cli)
- [Usage examples](#usage-examples)
- [Identity and permissions](#identity-and-permissions)
- [LLM provider](#llm-provider)
- [Environment variables](#environment-variables)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

---

## Architecture

```
apps/cli          Terminal interface: REPL, colors, confirmations, server config file
apps/host         HostService: orchestrates LLM + MCP servers and keeps the unified log
packages/mcp-client     MCP client: JSON-RPC 2.0, handshake, stdio transport
packages/llm-provider   LLMProvider interface + Anthropic adapter + test double
packages/conversation   Tool-calling loop, sessions and confirmations
```

Dependencies point one way only: `cli → host → conversation → llm-provider`, with `mcp-client`
wired in by the host. Three decisions hold that shape together:

**The LLM sits behind an interface.** `LLMProvider` has a single meaningful method,
`complete()`. Swapping providers means writing another implementation; nothing else in the
system notices. The Anthropic adapter is the **only** file that knows that message format.

**MCP servers are merged, not stacked.** `MultiServerToolRunner` presents several servers as a
single tool catalog. If two declare a tool with the same name it **fails explicitly** rather
than letting one silently win: a silent conflict would route calls to the wrong server.

**Confirmation is not the same as permission.** The CLI asks before a sensitive operation, but
the server validates the role on its own. The host is client code; a modified client might ask
nothing at all.

---

## Implemented features

- **MCP client written from scratch**: JSON-RPC 2.0 framing, request/response correlation,
  `initialize` handshake with **protocol version negotiation**, and stdio transport over a
  spawned subprocess.
- **Multi-server host**: any number of MCP servers merged into one tool catalog, with duplicate
  tool names rejected up front.
- **Declarative server configuration** in a JSON file — adding a server never requires touching
  code.
- **Tool-calling loop** with an iteration ceiling, so a confused model cannot loop forever.
- **Confirmation gate** for sensitive tools, where only an explicit "yes" approves.
- **Identity propagation**: role and user are passed to every MCP server, which enforces them.
- **Unified session log** interleaving MCP protocol traffic and conversation events, viewable
  with `/log`.
- **Provider-agnostic LLM layer**, with a real Anthropic adapter and a zero-cost demo provider
  that exercises the full MCP flow without an API key.
- **Colored terminal UI** with live tool-call activity, degrading cleanly on non-terminals and
  non-UTF-8 terminals.

---

## Requirements

- **Node.js 20+**
- **pnpm 11+** (`corepack enable` sets it up)
- The Go MCP server, already built — see its
  [README](../restaurant-mcp-server/README.md)
- *(Optional)* An Anthropic API key. Without one the CLI runs a demo provider, which is enough
  to exercise MCP end to end at no cost and with no network.

---

## Installation

```bash
# 1. Build the MCP server (in the other repository)
cd ../restaurant-mcp-server
go build -o bin/restaurant-mcp-server ./cmd/stdio

# 2. Install and build this project
cd ../restaurant-assistant
pnpm install
pnpm build

# 3. Declare the MCP server
cp apps/cli/mcp.servers.json.example apps/cli/mcp.servers.json
#    ...then adjust "command" if your path differs

# 4. (Optional) Configure the API key and role
cp apps/cli/.env.example apps/cli/.env

# 5. Run it
pnpm --filter @restaurant/cli start
```

> **Windows and WSL don't mix.** Pick one and stay there. A Go binary built inside WSL is a
> Linux executable and Windows' `node.exe` cannot launch it, even though both see the same
> disk.

---

## Configuring MCP servers

The server list lives in **`apps/cli/mcp.servers.json`**. Adding one means editing JSON — no
code changes, no rebuild.

```json
{
  "servers": [
    {
      "name": "restaurant-local",
      "description": "Recipe and inventory MCP server (Go).",
      "command": "../../../restaurant-mcp-server/bin/restaurant-mcp-server"
    },
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/expose"]
    },
    {
      "name": "classmate-server",
      "enabled": false,
      "command": "/path/to/binary",
      "env": { "API_TOKEN": "${CLASSMATE_TOKEN}" }
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Unique. Identifies the server in the log and in `/servers`. |
| `command` | yes | With `/` or `\` it is resolved **relative to the config file**; with no separator it is looked up on `PATH` (`npx`, `uvx`, `docker`). |
| `args` | no | Array of strings. |
| `env` | no | Extra environment variables for the subprocess. |
| `enabled` | no | `false` keeps the server documented but switched off. |
| `description` | no | For whoever reads the file; unused by the CLI. |

**Secrets.** Any value accepts `${VARIABLE}`, substituted from the environment at startup. If
the variable is missing the CLI **fails** instead of passing the raw text through — so a
missing token surfaces at startup rather than as a confusing server error. Keep secrets in
`.env` (git-ignored), never in the JSON.

**Paths are relative to the file, not the `cwd`.** The CLI can be launched from any directory;
anchoring to the file makes the same configuration work everywhere.

`mcp.servers.json` is git-ignored because it holds machine-specific paths; the versioned
template is `mcp.servers.json.example`.

### Where configuration comes from

1. `--config ./file.json` or `MCP_CONFIG_FILE` — if requested explicitly and missing, that is
   an error, not a silent fallback.
2. `apps/cli/mcp.servers.json`.
3. `MCP_SERVER_BIN` — a single server, for backward compatibility.

```bash
pnpm --filter @restaurant/cli start -- --config ./demos/two-servers.json
```

---

## Using the CLI

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

Each tool call is shown as it happens:

```
⚙ get_recipe_details · restaurant-local (dishId=chocolate-cake)
✓ get_recipe_details listo

◆ asistente
  El Pastel de Chocolate lleva harina de trigo (gluten), chocolate amargo...
```

### Commands

| Command | What it does |
|---|---|
| `/tools` | Discovered tools, their parameters, and which server exposes them |
| `/servers` | Connected servers and how many tools each contributes |
| `/log` | Unified log: MCP messages and conversation-loop events |
| `/clear` | Clears the screen without losing conversation history |
| `/help` | Help |
| `/exit` | Ends the session (`Ctrl+D` also works) |

**Color.** Enabled only when output is a terminal. `NO_COLOR=1` turns it off, `FORCE_COLOR=1`
forces it on. Symbols degrade to ASCII when the terminal doesn't declare UTF-8, and redirecting
to a file leaves no stray escape codes.

---

## Usage examples

### 1. Real availability, not a guess

```
▸ tú › ¿puedo vender dos hamburguesas especiales?

⚙ get_dish_availability · restaurant-local (dishId=special-burger, servings=2)
✓ get_dish_availability listo

◆ asistente
  No alcanza. Con el inventario actual sólo se puede preparar 0 porciones:
  hacen falta 160 g de queso cheddar y sólo hay 40 g.
```

The assistant computes nothing: the server returns the maximum possible and the ingredient that
limits it.

### 2. Allergens, without inventing

```
▸ tú › ¿el pastel de chocolate lleva gluten?
```

The answer comes from `get_recipe_details`, which returns **recorded** allergens. The system
prompt forbids inferring them: on an allergy question, a made-up answer is a real risk.

### 3. Adjusting inventory, with confirmation

```
▸ tú › se dañó queso, descuenta 10 gramos

╭ ▲ Operación sensible ─────────────────────────────────────╮
│ Se requiere tu confirmación — esta operación modifica datos│
│                                                            │
│   herramienta      adjust_inventory                        │
│   ingredientId     cheese                                  │
│   operation        subtract                                │
│   quantity         10                                      │
│   idempotencyKey   cli-demo-1788732710842-rmeamj           │
╰────────────────────────────────────────────────────────────╯

¿Confirmas? [s/N] s
✓ Operación confirmada.
```

Only an explicit "sí" approves: a blank Enter, anything else, or EOF all cancel. The
`idempotencyKey` ensures a retry does not subtract twice.

### 4. A denied permission, explained

With `MCP_USER_ROLE=waiter`, the same operation is confirmed in the interface and the server
**still** rejects it. The assistant explains it instead of crashing:

```
◆ asistente
  No tengo autorización para ajustar inventario con tu rol actual. Sólo cocina
  (cook) o administración (admin) pueden hacerlo.
```

### 5. Several servers at once

With more than one server enabled, `/servers` shows which tools each contributes, and live
calls indicate their origin (`⚙ read_file · filesystem`). The host presents them to the model
as a single catalog.

---

## Identity and permissions

The CLI **transports** the role; the server **validates** it.

| Role | Read | Adjust inventory |
|---|---|---|
| `waiter` (default) | ✅ | ❌ |
| `cook` | ✅ | ✅ |
| `admin` | ✅ | ✅ |

```bash
# apps/cli/.env
MCP_USER_ROLE=cook
MCP_USER_ID=diego
```

With stdio the server is a subprocess, so identity travels through the environment. The host
injects it into **every** configured server: it is the host that declares who it acts on behalf
of, not each entry in the file.

An unrecognized role does not escalate privileges — the server downgrades it to `waiter` — and
the CLI marks it in red at startup so you notice before attempting the operation.

---

## LLM provider

The default model is **`claude-haiku-4-5`**, the cheapest in the current family. It is more
than enough: the model decides which tool to call, but computes nothing — the Go domain does
that.

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5   # optional
```

Model identifiers use **hyphens, not dots**: `claude-haiku-4-5`, not `claude-haiku-4.5`. A
misspelled one produces a `404 not_found_error` on the first message.

**Without an API key** the CLI uses `HeuristicDemoProvider`, which recognizes intent by keyword
and calls the real tools. It demonstrates the entire MCP flow at no cost and with no network.

---

## Environment variables

All are optional and read from `apps/cli/.env` (git-ignored) or the shell.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Without it, the demo provider is used |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` | Model to use |
| `MCP_USER_ROLE` | `waiter` | Role transported to the servers |
| `MCP_USER_ID` | `unspecified` | Recorded in each adjustment's audit trail |
| `MCP_CONFIG_FILE` | — | An alternative server config file |
| `MCP_SERVER_BIN` | — | Single server, when there is no config file |
| `MCP_SERVER_ARGS` | — | Arguments for that single server |
| `HOST_MAX_ITERATIONS` | `8` | Cap on tool-calling rounds per turn |
| `NO_COLOR` / `FORCE_COLOR` | — | Disable or force color |

---

## Development

```bash
pnpm build       # build every package
pnpm test        # run every test suite
pnpm typecheck   # type-check without emitting
```

Tests touch neither the network nor an API key: the Anthropic adapter receives its
message-creation function by injection, and the MCP client is tested against a fake transport.

---

## Troubleshooting

**`spawn ENOENT` / error `-4058`.** Node could not find the server binary. It is almost always
one of three things: it isn't built, the path in `mcp.servers.json` is wrong, or it was built
for a different operating system (the Windows/WSL case). The CLI checks the binary **before**
launching it, and the message names which server failed and which directory the path was
resolved against.

**`404 not_found_error` naming the model.** The identifier is misspelled. Check that it uses
hyphens rather than dots.

**`400 ... does not support the fallbacks parameter`.** That parameter is only accepted by the
newest models. It is off by default; if you enabled it, turn it back off.

**The CLI starts in demo mode unexpectedly.** `ANTHROPIC_API_KEY` was not found. Check that
`apps/cli/.env` exists and that the line has no spaces around the `=`.

**Changes to the Go server don't show up.** Go compiles to a binary: re-run `go build` so the
CLI picks up the new code.

---

## Security

- **Permissions are enforced by the server.** The CLI's confirmation is an additional layer, not
  a substitute.
- **Sensitive operations require explicit confirmation**, and only "sí" approves.
- **Secrets never reach the repository.** `.env` and `mcp.servers.json` are git-ignored, and the
  JSON references credentials with `${VARIABLE}` rather than containing them.
- **Credentials are never logged.** The session log includes neither the API key nor the
  contents of environment variables.
- **If a credential is ever exposed, rotate it.** Even if it is deleted afterwards, assume it is
  compromised.
