/** Wire paths and payload types shared by the xiaocong-mcp host plugin and the settings panel. */

export const ROUTE = {
  /** Read the MCP server state and every agent binding state. */
  mcpStatus: '/xiaocong/mcp/status',
  /** Bind or unbind one external AI agent's MCP config file. */
  mcpBind: '/xiaocong/mcp/bind',
} as const

/** One external AI agent the shell can write an MCP server entry for. */
export interface XcyMcpAgentState {
  /** Stable agent key, also the field name inside the config file. */
  key: string
  /** Display label shown in the settings panel. */
  label: string
  /** Whether the agent's config file currently carries the xiaocongseek entry. */
  enabled: boolean
  /** Absolute config file path that was read. */
  path: string
  /** Whether the config file existed when it was last read. */
  present: boolean
  /** Human-readable write error, absent when the last operation succeeded. */
  error?: string
}

/** Full MCP server state answered by ROUTE.mcpStatus. */
export interface XcyMcpStatus {
  success: boolean
  /** Whether the streamable HTTP listener bound its port. */
  running: boolean
  /** Local listen port. */
  port: number
  /** URL other agents paste into their MCP configs. */
  url: string
  /** MCP server identity. */
  serverName: string
  /** Number of tools registered at boot. */
  toolCount: number
  /** Bind error message, absent when the listener is up. */
  error?: string
  agents: XcyMcpAgentState[]
}

/** Body for ROUTE.mcpBind. */
export interface XcyMcpBindBody {
  agent: string
  enabled: boolean
}
