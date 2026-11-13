// Retain the former empty route's 405 response without leaving an invalid TS module.
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'OPTIONS' } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { Allow: 'OPTIONS' } });
}
