export interface PdfImage {
  jpeg: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  pageWidth: number;
  pageHeight: number;
}

export interface PdfPage {
  width: number;
  height: number;
  ops: string;
  footer: string | null;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

function buildXref(offsets: number[], xrefPos: number, count: number): Uint8Array {
  return ascii(
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

  const tail = buildXref(offsets, size, offsets.length + 1);
  const out = new Uint8Array(size + tail.length);
  out.set(header, 0);
  let off = header.length;
  for (let i = 1; i < parts.length; i++) {
    out.set(parts[i], off);
    off += parts[i].length;
  }
  out.set(tail, off);
  return out;
}

export function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const LIGATURES: Record<string, string> = {
  '\u2013': '-',
  '\u2014': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': ',',
  '\u201B': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2026': '...',
  '\u02C6': '^',
  '\u02DC': '~',
  '\u2039': '<',
  '\u203A': '>',
  '\u20AC': 'EUR',
  '\u00A9': '(c)',
  '\u00AE': '(R)',
  '\u2122': '(TM)',
  '\u00B0': '\u00B0',
  '\u00B2': '\u00B2',
  '\u00B3': '\u00B3',
};

export function winEncode(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 32;
    if (c < 32) {
      out += ' ';
      continue;
    }
    if (c <= 0xff) {
      out += ch;
      continue;
    }
    out += LIGATURES[ch] ?? '?';
  }
  return out;
}

export function approxTextWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ' || ch === ',') w += size * 0.3;
    else if ('ij!.l|'.includes(ch)) w += size * 0.28;
    else if ('MW@'.includes(ch)) w += size * 0.85;
    else w += size * 0.52;
  }
  return w;
}

export function buildPdfDoc(pages: PdfPage[]): Uint8Array {
  const n = pages.length;
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
  const kids = pages.map((_, i) => `${3 + i} 0 R`).join(' ');
  push(ascii(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`), true);

  const font1 = 3 + n;
  const font2 = 4 + n;

  pages.forEach((pg, i) => {
    const objNo = 3 + i;
    const contentNo = 5 + n + i;
    push(
      ascii(
        `${objNo} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pg.width} ${pg.height}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentNo} 0 R >>\nendobj\n`,
      ),
      true,
    );
  });

  push(ascii(`${font1} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`), true);
  push(ascii(`${font2} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`), true);

  pages.forEach((pg, i) => {
    const contentNo = 5 + n + i;
    const content = pg.footer ? `${pg.ops}\n${footerOps(pg.footer, pg.width)}` : pg.ops;
    push(
      ascii(`${contentNo} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`),
      true,
    );
  });

  const tail = buildXref(offsets, size, offsets.length + 1);
  const out = new Uint8Array(size + tail.length);
  out.set(header, 0);
  let off = header.length;
  for (let i = 1; i < parts.length; i++) {
    out.set(parts[i], off);
    off += parts[i].length;
  }
  out.set(tail, off);
  return out;
}

function footerOps(label: string, pageWidth: number): string {
  const text = `  ${label}`;
  const size = 8;
  const w = approxTextWidth(winEncode(text), size);
  return `q\nBT\n0.45 0.42 0.38 rg\n/F1 ${size} Tf\n${Math.round(((pageWidth - w) / 2) * 100) / 100} 22 Td (${pdfEscape(winEncode(text))}) Tj\nET\nQ`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}