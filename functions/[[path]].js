import worker from '../src/worker.jsx';

export function onRequest(context) {
    return worker.fetch(context.request, context.env, context);
}
