const WORKER_URL = "https://sublink-worker.hhellovo.workers.dev";

export async function onRequest(context) {
  const incoming = new URL(context.request.url);
  const target = new URL(
    incoming.pathname + incoming.search,
    WORKER_URL
  );

  const request = new Request(target, context.request);

  return fetch(request);
}
