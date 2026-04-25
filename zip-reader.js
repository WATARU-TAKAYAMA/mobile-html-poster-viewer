const textDecoder = new TextDecoder();

function readUint16(view, offset) {
  return view.getUint16(offset, true);
}

function readUint32(view, offset) {
  return view.getUint32(offset, true);
}

function decodeName(bytes) {
  return textDecoder.decode(bytes);
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
  const entries = [];
  let offset = 0;

  while (offset + 30 <= buffer.byteLength) {
    const signature = readUint32(view, offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const flags = readUint16(view, offset + 6);
    const compression = readUint16(view, offset + 8);
    const compressedSize = readUint32(view, offset + 18);
    const uncompressedSize = readUint32(view, offset + 22);
    const nameLength = readUint16(view, offset + 26);
    const extraLength = readUint16(view, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const nameBytes = new Uint8Array(buffer, nameStart, nameLength);
    const name = decodeName(nameBytes);

    if (flags & 0x08) {
      throw new Error("データ記述子付きZIPは未対応です。通常のZIP形式で再作成してください。");
    }

    if (flags & 0x01) {
      throw new Error("暗号化ZIPは未対応です。パスワードなしのZIPを使ってください。");
    }

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
    offset = dataStart + compressedSize;
  }

  return entries.filter((entry) => entry.name && !entry.name.endsWith("/"));
}
