import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp/server";
import { publishDue } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** MCP（Streamable HTTP，無狀態）：Authorization: Bearer $MCP_TOKEN */
function authorized(req: Request): boolean {
  const token = process.env.MCP_TOKEN || "";
  if (token.length < 32) return false;
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function unauthorized() {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="dayinup-mcp"' },
  });
}

async function handle(req: Request) {
  if (!process.env.MCP_TOKEN) return new Response("MCP_TOKEN 未設定", { status: 503 });
  if (!authorized(req)) return unauthorized();
  await publishDue();
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const server = buildMcpServer({ type: "mcp", id: "mcp-token", email: null, ip, ua: req.headers.get("user-agent") });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // 無狀態：每個請求一組 server/transport
    void transport.close();
    void server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
