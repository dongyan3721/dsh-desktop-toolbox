import { agentError, throwIfAborted } from './common.js'

export const MAX_AGENT_IMAGE_BYTES = 16 * 1024 * 1024
export const MAX_AGENT_IMAGE_PIXELS = 16_000_000
export const MAX_ARTIFACT_ID_SCALARS = 200

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

function internal(message) {
  return agentError('INTERNAL', message)
}

function unsupported(message) {
  return agentError('UNSUPPORTED', message)
}

function validateArtifactId(value) {
  if (typeof value !== 'string' || value === '') throw internal('artifact_id is missing')
  let scalars = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint >= 0xD800 && codePoint <= 0xDFFF) throw internal('artifact_id is malformed')
    if (codePoint < 0x20) throw internal('artifact_id is malformed')
    scalars += 1
    if (scalars > MAX_ARTIFACT_ID_SCALARS) throw internal('artifact_id is too long')
  }
  return value
}

export function validateArtifactDescriptor(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw internal('native image descriptor is not an object')
  }
  const artifactId = validateArtifactId(value.artifact_id)
  if (value.mime_type !== 'image/png') {
    throw unsupported('native image descriptor must be image/png')
  }
  if (!Number.isSafeInteger(value.byte_length) || value.byte_length < 1) {
    throw internal('native image byte_length is invalid')
  }
  if (value.byte_length > MAX_AGENT_IMAGE_BYTES) {
    throw unsupported(`native image exceeds the ${MAX_AGENT_IMAGE_BYTES}-byte Agent limit`)
  }
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
    || value.width < 1 || value.height < 1 || value.width > 65535 || value.height > 65535) {
    throw internal('native image dimensions are invalid')
  }
  if (value.width * value.height > MAX_AGENT_IMAGE_PIXELS) {
    throw unsupported('native image exceeds the Agent pixel limit')
  }
  return {
    artifact_id: artifactId,
    mime_type: 'image/png',
    byte_length: value.byte_length,
    width: value.width,
    height: value.height,
  }
}

function normalizeLoadedImage(loaded, descriptor) {
  if (!(loaded instanceof Uint8Array)) {
    if (loaded === null || typeof loaded !== 'object' || !(loaded.data instanceof Uint8Array)) {
      throw internal('artifact reader must return image bytes')
    }
    if (loaded.mediaType !== undefined && loaded.mediaType !== descriptor.mime_type) {
      throw internal('artifact media type does not match its descriptor')
    }
    loaded = loaded.data
  }
  if (loaded.byteLength !== descriptor.byte_length) {
    throw internal('artifact byte length does not match its descriptor')
  }
  if (loaded.byteLength > MAX_AGENT_IMAGE_BYTES) {
    throw unsupported('artifact exceeds the Agent image byte limit')
  }
  return loaded
}

function normalizeImageRef(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw internal('attachment store returned an invalid image reference')
  }
  if (typeof value.attachmentId !== 'string' || value.attachmentId === '') {
    throw internal('attachment store returned an invalid image id')
  }
  if (!SUPPORTED_IMAGE_TYPES.has(value.mediaType)) {
    throw internal('attachment store returned an unsupported image type')
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_AGENT_IMAGE_BYTES) {
    throw internal('attachment store returned invalid image bytes')
  }
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
    || value.width < 1 || value.height < 1) {
    throw internal('attachment store returned invalid image dimensions')
  }
  const image = {
    attachmentId: value.attachmentId,
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
  }
  if (typeof value.name === 'string' && value.name !== '') image.name = value.name
  if (value.originalDimensions !== null && typeof value.originalDimensions === 'object'
    && Number.isSafeInteger(value.originalDimensions.width)
    && Number.isSafeInteger(value.originalDimensions.height)
    && value.originalDimensions.width > 0 && value.originalDimensions.height > 0) {
    image.originalDimensions = {
      width: value.originalDimensions.width,
      height: value.originalDimensions.height,
    }
  }
  return image
}

function attachmentName(moduleId) {
  return moduleId === 'screen_ink' ? 'toolbox-ink-snapshot.png' : 'toolbox-screenshot.png'
}

/**
 * Build a publisher for native artifact descriptors.
 *
 * Codex supplies `artifactReader.read(descriptor, { signal })` -> Uint8Array or
 * `{ data: Uint8Array, mediaType?: 'image/png' }`. It must resolve the native
 * artifact id through the owned desktop runtime; this module never reads a
 * caller-supplied path. The attachment store is the installed durable
 * `ctx.attachments` service whose `saveImage({data, mediaType, name})`
 * returns an ImageAttachmentRef.
 */
export function createAgentImagePublisher({ attachments, artifactReader }) {
  if (attachments === null || typeof attachments !== 'object'
    || typeof attachments.saveImage !== 'function') {
    throw new TypeError('createAgentImagePublisher requires ctx.attachments.saveImage')
  }
  if (artifactReader === null || typeof artifactReader !== 'object'
    || typeof artifactReader.read !== 'function') {
    throw new TypeError('createAgentImagePublisher requires a toolboxArtifacts.read descriptor reader')
  }

  return {
    async publish({ moduleId, descriptor, signal, ensureAuthorized }) {
      if (typeof ensureAuthorized !== 'function') throw new TypeError('image publication requires an access recheck')
      throwIfAborted(signal)
      const artifact = validateArtifactDescriptor(descriptor)

      await ensureAuthorized(signal)
      throwIfAborted(signal)
      const loaded = await artifactReader.read(artifact, { signal })
      throwIfAborted(signal)
      const data = normalizeLoadedImage(loaded, artifact)

      await ensureAuthorized(signal)
      throwIfAborted(signal)
      const ref = await attachments.saveImage({
        data,
        mediaType: artifact.mime_type,
        name: attachmentName(moduleId),
      })
      throwIfAborted(signal)
      const image = normalizeImageRef(ref)

      await ensureAuthorized(signal)
      throwIfAborted(signal)
      return { artifact, image }
    },
  }
}
