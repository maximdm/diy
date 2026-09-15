export interface PdfImage {
  jpeg: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  pageWidth: number;
  pageHeight: number;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

export function buildPdf(img: PdfImage): Uint8Array {
  const jpgLen = img.jpeg.length;
  const w = Math.round(img.pageWidth * 100) / 100;
  const h = Math.round(img.pageHeight * 100) / 100;

  const header = ascii('%PDF-1.4\n');
  const parts: Uint8Array[] = [header];
  const offsets: number[] = [];
  let size = header.length;
  const push = (u: Uint8Array, isObj: boolean): void => {
    if (isObj) offsets.push(size);
    parts.push(u);
    size += u.length;
  };

  push(ascii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'), true);
  push(ascii('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'), true);
  push(
    ascii(
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
        w +
        ' ' +
        h +
        '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    ),
    true,
  );
  push(
    ascii(
      '4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' +
        img.imageWidth +
        ' /Height ' +
        img.imageHeight +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
        jpgLen +
        ' >>\nstream\n',
    ),
    true,
  );
  push(img.jpeg, false);
  push(ascii('\nendstream\nendobj\n'), false);
  const content = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im0 Do Q\n';
  push(ascii('5 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n'), true);

  const xrefPos = size;
  const count = offsets.length + 1;
  const tail = ascii(
    'xref\n0 ' +
      count +
      '\n' +
      pad(0, 10) +
      ' 65535 f \n' +
      offsets
        .map((o) => pad(o, 10) + ' 00000 n \n')
        .join('') +
      'trailer\n<< /Size ' +
      count +
      ' /Root 1 0 R >>\nstartxref\n' +
      xrefPos +
      '\n%%EOF\n',
  );

  const out = new Uint8Array(size + tail.length);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  out.set(tail, off);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}