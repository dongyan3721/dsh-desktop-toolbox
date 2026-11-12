import { cp, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
await mkdir(new URL('packages/dsh-toolbox/lib/', root), { recursive: true });
await cp(new URL('packages/dsh-toolbox/src/', root), new URL('packages/dsh-toolbox/lib/', root), { recursive: true });
console.log('Built packages/dsh-toolbox/lib (ESM JavaScript)');
