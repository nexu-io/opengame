import { crc32, deflateRawSync } from 'node:zlib';

export function zip(entries, { deflate = false } = {}) {
  const local = [], central = []; let offset = 0, directorySize = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const crc = crc32(entry.data);
    const compressed = deflate && entry.data.length >= 128 ? deflateRawSync(entry.data) : entry.data;
    const useDeflate = compressed.length < entry.data.length;
    const payload = useDeflate ? compressed : entry.data;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(useDeflate ? 8 : 0, 8); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18); header.writeUInt32LE(entry.data.length, 22); header.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x800, 8); dir.writeUInt16LE(useDeflate ? 8 : 0, 10); dir.writeUInt16LE(33, 14); dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(payload.length, 20); dir.writeUInt32LE(entry.data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(header, name, payload); central.push(dir, name);
    offset += header.length + name.length + payload.length; directorySize += dir.length + name.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
