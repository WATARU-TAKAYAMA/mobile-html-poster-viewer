const textDecoder = new TextDecoder();
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_EXTRA = 0x0001;
const UINT32_MAX = 0xffffffff;

function readUint16(view, offset) {
  return view.getUint16(offset, true);
}

function readUint32(view, offset) {
  return view.getUint32(offset, true);
}

function decodeName(bytes) {
  return textDecoder.decode(bytes);
}

function findEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);

  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(view, offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }

  throw new Error("ZIPの中央ディレクトリが見つかりませんでした。");
}

function readZip64Extra(extraBytes, entry) {
  let offset = 0;
  let uncompressedSize = entry.uncompressedSize;
  let compressedSize = entry.compressedSize;
  let localHeaderOffset = entry.localHeaderOffset;

  while (offset + 4 <= extraBytes.byteLength) {
    const headerId = readUint16(extraBytes, offset);
    const dataSize = readUint16(extraBytes, offset + 2);
    const dataOffset = offset + 4;
    const dataEnd = dataOffset + dataSize;
    let cursor = dataOffset;

    if (headerId === ZIP64_EXTRA) {
      if (uncompressedSize === UINT32_MAX && cursor + 8 <= dataEnd) {
        uncompressedSize = Number(extraBytes.getBigUint64(cursor, true));
        cursor += 8;
      }
      if (compressedSize === UINT32_MAX && cursor + 8 <= dataEnd) {
        compressedSize = Number(extraBytes.getBigUint64(cursor, true));
        cursor += 8;
      }
      if (localHeaderOffset === UINT32_MAX && cursor + 8 <= dataEnd) {
        localHeaderOffset = Number(extraBytes.getBigUint64(cursor, true));
      }
    }

    offset = dataEnd;
  }

  return { ...entry, uncompressedSize, compressedSize, localHeaderOffset };
}

function readCentralDirectory(view, centralDirectoryOffset, totalEntries) {
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (readUint32(view, offset) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error("ZIPの中央ディレクトリを読み取れませんでした。");
    }

    const flags = readUint16(view, offset + 8);
    const compression = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const nameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localHeaderOffset = readUint32(view, offset + 42);
    const nameStart = offset + 46;
    const extraStart = nameStart + nameLength;
    const commentStart = extraStart + extraLength;
    const name = decodeName(new Uint8Array(view.buffer, nameStart, nameLength));
    const extraBytes = new DataView(view.buffer, extraStart, extraLength);

    entries.push(
      readZip64Extra(extraBytes, {
        name,
        flags,
        compression,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      }),
    );

    offset = commentStart + commentLength;
  }

  return entries;
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("このブラウザはZIP展開に必要なDecompressionStreamに対応していません。iOS 16.4以降のSafariを推奨します。");
  }

  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntries(file) {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const totalEntries = readUint16(view, eocdOffset + 10);
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16);
  const centralEntries = readCentralDirectory(view, centralDirectoryOffset, totalEntries);
  const entries = [];

  for (const entry of centralEntries) {
    const { name, flags, compression, compressedSize, uncompressedSize, localHeaderOffset } = entry;
    if (flags & 0x01) {
      throw new Error("暗号化ZIPは未対応です。パスワードなしのZIPを使ってください。");
    }

    if (name.endsWith("/")) {
      continue;
    }

    if (readUint32(view, localHeaderOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`${name} のローカルヘッダーを読み取れませんでした。`);
    }

    const localNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;

    if (dataStart + compressedSize > buffer.byteLength) {
      throw new Error("ZIPの内容を読み取れませんでした。ファイルが壊れている可能性があります。");
    }

    const compressedBytes = new Uint8Array(buffer, dataStart, compressedSize);
    let bytes;

    if (compression === 0) {
      bytes = new Uint8Array(compressedBytes);
    } else if (compression === 8) {
      bytes = await inflateRaw(compressedBytes);
    } else {
      throw new Error(`未対応のZIP圧縮方式です: ${compression}`);
    }

    if (uncompressedSize && bytes.byteLength !== uncompressedSize) {
      throw new Error(`${name} の展開サイズが一致しません。`);
    }

    entries.push({ name, bytes });
  }

  return entries.filter((entry) => entry.name);
}
