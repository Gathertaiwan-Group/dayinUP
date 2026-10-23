export function GET(req: Request) {
  return Response.redirect(new URL('/sitemap_index.xml', req.url), 301)
}
