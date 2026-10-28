import 'server-only'

/** NewebPay posts application/x-www-form-urlencoded; also accept JSON / multipart for tooling. */
export async function readInbound(req: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const ct = req.headers.get('content-type') || ''
  try {
    if (ct.includes('application/json')) {
      const j = (await req.json()) as Record<string, unknown>
      for (const [k, v] of Object.entries(j || {})) if (typeof v === 'string') out[k] = v
    } else {
      const fd = await req.formData()
      for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v
    }
  } catch {
    /* empty body */
  }
  return out
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
