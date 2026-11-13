import { cp, mkdir, lstat, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const destination = new URL('packages/dsh-toolbox/lib/', root);
// This fixed workspace output must never retain removed source files or be a junction.
const existing = await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (existing?.isSymbolicLink()) throw new Error('Refusing to replace a linked lib directory');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(new URL('packages/dsh-toolbox/src/', root), destination, { recursive: true });
console.log('Built packages/dsh-toolbox/lib (ESM JavaScript)');
