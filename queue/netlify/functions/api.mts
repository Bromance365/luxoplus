import { getStore, getDeployStore } from '@netlify/blobs';
import { createHandler, type Store } from './handler.mts';

// Production data lives in a global store; previews and branch deploys use their own deploy store
// so test tickets never reach production.
function blobStore(): Store {
  const name = 'luxoplus-queue';
  const s = Netlify.context?.deploy?.context === 'production'
    ? getStore({ name, consistency: 'strong' })
    : getDeployStore({ name, consistency: 'strong' } as never);
  return {
    async get(key) {
      const r = await s.getWithMetadata(key, { type: 'json', consistency: 'strong' });
      return r ? { data: r.data as never, etag: r.etag } : null;
    },
    async set(key, value, cond) {
      const r = await s.setJSON(key, value, cond.onlyIfMatch ? { onlyIfMatch: cond.onlyIfMatch } : cond.onlyIfNew ? { onlyIfNew: true } : {});
      return r.modified;
    },
    async del(key) { await s.delete(key); },
  };
}

export default async (req: Request) => {
  const handle = createHandler({ store: blobStore(), env: (k) => Netlify.env.get(k), now: () => Date.now() });
  return handle(req);
};

export const config = { path: '/api/*' };
