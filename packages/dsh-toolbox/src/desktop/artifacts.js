import { Service } from '@deepseek-ai/cordis';
import { hostError } from '../host/native-owner.js';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const CHUNK_BYTES = 65536;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const invalid = () => hostError('DESKTOP_PROTOCOL', 'Invalid or changed image artifact');

export function checkDescriptor(value) {
  if (!value || !/^[a-fA-F0-9]{32}$/.test(value.artifact_id)
    || value.mime_type !== 'image/png' || !Number.isSafeInteger(value.byte_length)
    || value.byte_length < 33 || value.byte_length > MAX_BYTES
    || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
    || value.width < 1 || value.height < 1 || value.width * value.height > MAX_PIXELS
    || (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 0))) throw invalid();
  return { artifact_id: value.artifact_id, mime_type: 'image/png', byte_length: value.byte_length, width: value.width, height: value.height,
    ...(value.module_id !== undefined ? { module_id: value.module_id } : {}),
    ...(value.revision !== undefined ? { revision: value.revision } : {}) };
}

/** Only the native ledger resolves IDs; no local paths are ever read here. */
export async function readAgentArtifact(desktop, descriptor, { signal, moduleId: requestedModule, revision: requestedRevision } = {}) {
  signal?.throwIfAborted();
  const image = checkDescriptor({ ...descriptor,
    ...(requestedModule !== undefined ? { module_id: requestedModule } : {}),
    ...(requestedRevision !== undefined ? { revision: requestedRevision } : {}),
  });
  if ((descriptor.module_id !== undefined && descriptor.module_id !== image.module_id)
    || (descriptor.revision !== undefined && descriptor.revision !== image.revision)) throw invalid();
  const candidates = image.module_id === undefined ? ['screenshot', 'screen_ink'] : [image.module_id];
  if (candidates.some(id => !['screenshot', 'screen_ink'].includes(id))) throw invalid();
  const snapshot = await desktop.getAgentAccess({ signal });
  // A2 descriptors lacked module_id. Try only currently granted image modules;
  // native must match the ID's ledger owner. No guessing filesystem paths.
  const allowed = candidates.filter(id => snapshot.modules.some(module => module.id === id && module.agent_effective && module.agent_allowed && module.agent_supported));
  if (allowed.length === 0) throw hostError('AGENT_ACCESS_DENIED', 'Image module is not granted');
  let moduleId;
  let first;
  for (const candidate of allowed) {
    try {
      first = await desktop.agentCall('agent.artifacts.read', { artifact_id: image.artifact_id, module_id: candidate, offset: 0, length: CHUNK_BYTES }, { signal });
      moduleId = candidate;
      break;
    } catch (error) {
      // Wrong owner is an explicit validation rejection, never retry any writes.
      if (error?.code !== 'INVALID_REQUEST' || candidate === allowed.at(-1)) throw error;
    }
  }
  const chunks = [];
  let offset = 0;
  let revision;
  while (offset < image.byte_length) {
    signal?.throwIfAborted();
    const chunk = offset === 0 ? first : await desktop.agentCall('agent.artifacts.read', {
      artifact_id: image.artifact_id, module_id: moduleId, offset, length: CHUNK_BYTES,
    }, { signal });
    if (!chunk || chunk.artifact_id !== image.artifact_id || chunk.module_id !== moduleId || chunk.offset !== offset
      || chunk.total_bytes !== image.byte_length || chunk.mime_type !== image.mime_type
      || chunk.width !== image.width || chunk.height !== image.height
      || !Number.isSafeInteger(chunk.revision) || chunk.revision < 0
      || (revision !== undefined && chunk.revision !== revision)
      || (image.revision !== undefined && chunk.revision !== image.revision)
      || typeof chunk.data_base64 !== 'string' || chunk.data_base64.length > 4 * Math.ceil(CHUNK_BYTES / 3)
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk.data_base64)) throw invalid();
    const bytes = Buffer.from(chunk.data_base64, 'base64');
    if (bytes.length === 0 || bytes.length > CHUNK_BYTES || bytes.length > image.byte_length - offset
      || bytes.toString('base64') !== chunk.data_base64 || chunk.eof !== (offset + bytes.length === image.byte_length)) throw invalid();
    revision = chunk.revision;
    chunks.push(bytes);
    offset += bytes.length;
  }
  const latest = await desktop.getAgentAccess({ signal });
  if (latest.revision !== snapshot.revision) throw hostError('AGENT_ACCESS_DENIED', 'Image authorization changed while reading');
  if (!latest.modules.some(module => module.id === moduleId && module.agent_effective && module.agent_allowed && module.agent_supported)) {
    throw hostError('AGENT_ACCESS_DENIED', 'Image access was revoked');
  }
  signal?.throwIfAborted();
  const bytes = Buffer.concat(chunks, image.byte_length);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13
    || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== image.width
    || bytes.readUInt32BE(20) !== image.height) throw invalid();
  return { data: bytes, mediaType: 'image/png' };
}

export class ToolboxArtifactService extends Service {
  constructor(ctx, desktop) {
    super(ctx, 'toolboxArtifacts');
    this.desktop = desktop;
  }
  read(descriptor, options) { return readAgentArtifact(this.desktop, descriptor, options); }
}
