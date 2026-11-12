// Generated 2x2 RGB BMP fixture; contains no user media or external assets.
export function tinyBmp() {
  const bytes = Buffer.alloc(70);
  bytes.write('BM'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(2, 18); bytes.writeInt32LE(2, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(16, 34);
  Buffer.from([0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0]).copy(bytes, 54);
  return bytes;
}

export function imageDimensions(bytes, format) {
  if (format === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (format === 'bmp' && bytes.toString('ascii', 0, 2) === 'BM') return [bytes.readInt32LE(18), Math.abs(bytes.readInt32LE(22))];
  if (format === 'ico' && bytes.readUInt32LE(0) === 65536 && bytes.readUInt16LE(4) > 0) return [bytes[6] || 256, bytes[7] || 256];
  if (format === 'jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker >= 208 && marker <= 217) continue;
      const size = bytes.readUInt16BE(offset);
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      offset += size;
    }
  }
  if (format === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const codec = bytes.toString('ascii', 12, 16);
    if (codec === 'VP8L' && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21);
      return [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1];
    }
    if (codec === 'VP8 ') return [bytes.readUInt16LE(26) & 16383, bytes.readUInt16LE(28) & 16383];
  }
  throw new Error(`Output is not a supported ${format} image`);
}
