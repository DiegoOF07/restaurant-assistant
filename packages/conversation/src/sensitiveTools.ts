/**
 * Qué herramientas no se ejecutan sin que el usuario diga que sí.
 *
 * El criterio es el efecto, no de quién viene: una herramienta entra aquí si escribe algo
 * que el usuario no puede deshacer con sólo volver a preguntar — inventario, archivos en
 * disco, historia de un repositorio. Las de lectura (buscar, listar, calcular contraste,
 * `git_status`) no entran: pedir permiso para leer entrena a decir que sí sin mirar, que es
 * justo lo que hace inútil la confirmación cuando llega la que sí importa.
 *
 * Es una lista de nombres porque el protocolo MCP no obliga a un servidor a declarar si una
 * herramienta destruye datos: los `annotations` son opcionales y un servidor de un tercero
 * puede mentir. La decisión la toma el host, con lo que sabe de cada servidor que habilitó.
 */
export const DEFAULT_TOOLS_REQUIRING_CONFIRMATION: readonly string[] = [
  // restaurant-mcp-server: descuenta existencias reales.
  "adjust_inventory",

  // Filesystem MCP server: crean, sobrescriben o mueven archivos del disco.
  "write_file",
  "edit_file",
  "create_directory",
  "move_file",

  // Git MCP server: modifican el índice, el árbol de trabajo o la historia del repositorio.
  // `git_add` entra porque prepara un commit; `git_checkout` y `git_reset`, porque pueden
  // descartar cambios sin guardar.
  "git_add",
  "git_commit",
  "git_reset",
  "git_checkout",
  "git_create_branch",
  "git_init",
];
