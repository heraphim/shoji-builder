/**
 * A PDF writer, cut down to what a blueprint sheet is made of.
 *
 * Lines, dashed lines, filled rectangles, text and one embedded JPEG. That is
 * the whole of a drawing sheet, and it is small enough that a writer for it is
 * shorter than the wrapper around a general-purpose library would be — this file
 * against 350 kB of jsPDF, in a project whose every other dependency is there to
 * put triangles on a screen.
 *
 * Two decisions do most of the simplifying:
 *
 * - **Courier and Courier-Bold, and nothing else.** They are two of the standard
 *   14 fonts, so nothing has to be embedded, and every glyph is exactly 0.6 em
 *   wide — which makes centring text *exact* arithmetic rather than a lookup
 *   against a widths table this file would otherwise have to carry. A technical
 *   drawing lettered in a monospace face is also the convention rather than a
 *   compromise.
 * - **Coordinates are millimetres**, y up, origin at the bottom-left of the
 *   sheet. The whole app works in millimetres; converting to points at the one
 *   place the bytes are written keeps every caller in the unit it thinks in.
 *
 * Streams are uncompressed. Deflate without a dependency is the one piece of
 * this that would not be short, and a sheet is tens of kilobytes either way.
 */

const MM_TO_PT = 72 / 25.4;

/** How wide one character is, as a fraction of the font size. Courier is fixed. */
const COURIER_ADVANCE = 0.6;
// Courier's cap height, for centring a line of text on a point rather than
// sitting it on one. Both are fractions of the em.
const COURIER_CAP = 0.562;
const UNDERLINE_DROP = 0.22;

export type PdfFont = "mono" | "monoBold";

export interface TextOptions {
  /** Em size, in millimetres. */
  size: number;
  font?: PdfFont;
  colour?: string;
  align?: "left" | "center" | "right";
  /** `alphabetic` sits the text on `y`; `middle` centres it on `y`. */
  baseline?: "alphabetic" | "middle";
  underline?: boolean;
}

export interface StrokeStyle {
  colour: string;
  /** Line width in millimetres. */
  width: number;
  /** Dash and gap in millimetres. Omitted or empty draws solid. */
  dash?: [number, number];
}

/** A line segment on the sheet, in millimetres. */
export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The width of a string at a given size, in millimetres. */
export function textWidth(text: string, size: number): number {
  return text.length * size * COURIER_ADVANCE;
}

/**
 * A string cut to fit a width, with an ellipsis where it was cut.
 *
 * Nothing in a PDF clips: text that does not fit is simply drawn past the edge
 * of whatever it was meant to be inside, over the top of its neighbour. On a
 * sheet of cards or a table of columns that is not a cosmetic problem — two
 * overlapping strings are less readable than either of them alone, so a cell
 * that overflows takes its neighbour down with it.
 */
export function clipText(text: string, maxWidth: number, size: number): string {
  if (textWidth(text, size) <= maxWidth) return text;
  const room = Math.floor(maxWidth / (size * COURIER_ADVANCE)) - 1;
  return room <= 0 ? "" : `${text.slice(0, room)}…`;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

// The few non-ASCII characters a cut list actually wants, at their WinAnsi
// codes. Everything else outside the printable range becomes a question mark,
// which is visible in the output rather than silently shifting the encoding.
const WIN_ANSI: Record<string, number> = {
  "×": 0xd7, // multiplication sign
  "°": 0xb0, // degree
  "–": 0x96, // en dash
  "—": 0x97, // em dash
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "…": 0x85,
};

/**
 * A string as a PDF literal, escaped and folded to WinAnsi.
 *
 * Every byte comes back below 256, so the whole content stream can be carried
 * as a JS string and encoded a character at a time at the end.
 */
function pdfString(text: string): string {
  let out = "(";
  for (const ch of text) {
    const mapped = WIN_ANSI[ch];
    if (mapped !== undefined) {
      out += String.fromCharCode(mapped);
      continue;
    }
    const code = ch.codePointAt(0) ?? 63;
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code >= 32 && code <= 126) out += ch;
    else out += "?";
  }
  return out + ")";
}

/** Numbers in a content stream: short, and never in exponent notation. */
function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function colourOps(hex: string, fill: boolean): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return `${num(r)} ${num(g)} ${num(b)} ${fill ? "rg" : "RG"}`;
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

// ---------------------------------------------------------------------------
// One page
// ---------------------------------------------------------------------------

export class PdfPage {
  /** @internal */
  readonly ops: string[] = [];
  /** @internal */
  readonly usedImages = new Set<number>();

  private readonly document: PdfDocument;
  readonly width: number;
  readonly height: number;

  constructor(document: PdfDocument, width: number, height: number) {
    this.document = document;
    this.width = width;
    this.height = height;
  }

  private xy(x: number, y: number): string {
    return `${num(x * MM_TO_PT)} ${num(y * MM_TO_PT)}`;
  }

  /**
   * A batch of segments in one style, as a single path.
   *
   * Batching is the difference between a readable file and a slow one: a
   * projection is thousands of segments, and a colour and width operator in
   * front of each of them triples the stream for no effect on the page.
   */
  lines(segments: Seg[], style: StrokeStyle): void {
    if (segments.length === 0) return;
    this.ops.push("q");
    this.ops.push(colourOps(style.colour, false));
    this.ops.push(`${num(style.width * MM_TO_PT)} w`);
    if (style.dash && style.dash[0] > 0) {
      this.ops.push(`[${num(style.dash[0] * MM_TO_PT)} ${num(style.dash[1] * MM_TO_PT)}] 0 d`);
    }
    for (const s of segments) {
      this.ops.push(`${this.xy(s.x0, s.y0)} m ${this.xy(s.x1, s.y1)} l`);
    }
    this.ops.push("S");
    this.ops.push("Q");
  }

  /** An axis-aligned rectangle, filled, stroked, or both. */
  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    style: { fill?: string; stroke?: StrokeStyle }
  ): void {
    if (!style.fill && !style.stroke) return;
    this.ops.push("q");
    if (style.fill) this.ops.push(colourOps(style.fill, true));
    if (style.stroke) {
      this.ops.push(colourOps(style.stroke.colour, false));
      this.ops.push(`${num(style.stroke.width * MM_TO_PT)} w`);
    }
    this.ops.push(
      `${this.xy(x, y)} ${num(width * MM_TO_PT)} ${num(height * MM_TO_PT)} re`
    );
    this.ops.push(style.fill && style.stroke ? "B" : style.fill ? "f" : "S");
    this.ops.push("Q");
  }

  /** One line of text. `x` is its left edge, centre or right edge per `align`. */
  text(text: string, x: number, y: number, options: TextOptions): void {
    if (text.length === 0) return;
    const size = options.size;
    const width = textWidth(text, size);
    const left =
      options.align === "center" ? x - width / 2 : options.align === "right" ? x - width : x;
    const baseline = options.baseline === "middle" ? y - (size * COURIER_CAP) / 2 : y;
    const font = options.font === "monoBold" ? "/F2" : "/F1";

    this.ops.push("q");
    this.ops.push(colourOps(options.colour ?? "#000000", true));
    this.ops.push("BT");
    this.ops.push(`${font} ${num(size * MM_TO_PT)} Tf`);
    this.ops.push(`${this.xy(left, baseline)} Td`);
    this.ops.push(`${pdfString(text)} Tj`);
    this.ops.push("ET");
    if (options.underline) {
      const uy = baseline - size * UNDERLINE_DROP;
      this.ops.push(`${num(size * 0.06 * MM_TO_PT)} w`);
      this.ops.push(colourOps(options.colour ?? "#000000", false));
      this.ops.push(`${this.xy(left, uy)} m ${this.xy(left + width, uy)} l S`);
    }
    this.ops.push("Q");
  }

  /**
   * A JPEG, scaled into the given rectangle.
   *
   * JPEG only, and the bytes go in verbatim: `DCTDecode` is the one image filter
   * a PDF takes in the wild format it already arrived in, so there is no encoder
   * here at all. The pixel dimensions are the caller's because the only caller
   * reads them off the canvas it just rendered — a parser for the SOF marker
   * would be re-deriving what is already known.
   */
  image(jpeg: Uint8Array, pixelWidth: number, pixelHeight: number, x: number, y: number, width: number, height: number): void {
    const id = this.document.registerImage(jpeg, pixelWidth, pixelHeight);
    this.usedImages.add(id);
    this.ops.push("q");
    this.ops.push(
      `${num(width * MM_TO_PT)} 0 0 ${num(height * MM_TO_PT)} ${this.xy(x, y)} cm`
    );
    this.ops.push(`/Im${id} Do`);
    this.ops.push("Q");
  }
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

interface Jpeg {
  data: Uint8Array;
  width: number;
  height: number;
}

export class PdfDocument {
  private readonly pages: PdfPage[] = [];
  private readonly images: Jpeg[] = [];

  addPage(widthMm: number, heightMm: number): PdfPage {
    const page = new PdfPage(this, widthMm, heightMm);
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** @internal — an image is registered once and referenced by every user. */
  registerImage(data: Uint8Array, width: number, height: number): number {
    const existing = this.images.findIndex((image) => image.data === data);
    if (existing >= 0) return existing;
    this.images.push({ data, width, height });
    return this.images.length - 1;
  }

  /**
   * The file.
   *
   * Object numbers are handed out arithmetically before any body is written,
   * because the page tree has to name its children and each page has to name its
   * content stream. The xref table that follows is byte offsets into what has
   * been emitted, which is why the parts are assembled as a list and measured as
   * they go rather than concatenated at the end.
   */
  build(): Uint8Array {
    const FONT_REGULAR = 3;
    const FONT_BOLD = 4;
    let next = 5;
    const imageIds = this.images.map(() => next++);
    const pageIds = this.pages.map(() => ({ content: next++, page: next++ }));
    const total = next - 1;

    const bodies = new Map<number, string | Uint8Array>();

    bodies.set(1, `<< /Type /Catalog /Pages 2 0 R >>`);
    bodies.set(
      2,
      `<< /Type /Pages /Count ${this.pages.length} /Kids [${pageIds
        .map((ids) => `${ids.page} 0 R`)
        .join(" ")}] >>`
    );
    bodies.set(
      FONT_REGULAR,
      `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`
    );
    bodies.set(
      FONT_BOLD,
      `<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>`
    );

    this.images.forEach((image, i) => {
      const header =
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}` +
        ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode` +
        ` /Length ${image.data.length} >>\nstream\n`;
      const parts = [latin1(header), image.data, latin1("\nendstream")];
      const merged = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const part of parts) {
        merged.set(part, at);
        at += part.length;
      }
      bodies.set(imageIds[i], merged);
    });

    this.pages.forEach((page, i) => {
      const stream = page.ops.join("\n");
      bodies.set(
        pageIds[i].content,
        `<< /Length ${latin1(stream).length} >>\nstream\n${stream}\nendstream`
      );
      const xobjects =
        page.usedImages.size === 0
          ? ""
          : ` /XObject << ${[...page.usedImages]
              .map((id) => `/Im${id} ${imageIds[id]} 0 R`)
              .join(" ")} >>`;
      bodies.set(
        pageIds[i].page,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width * MM_TO_PT)} ${num(
          page.height * MM_TO_PT
        )}] /Resources << /Font << /F1 ${FONT_REGULAR} 0 R /F2 ${FONT_BOLD} 0 R >>${xobjects} >>` +
          ` /Contents ${pageIds[i].content} 0 R >>`
      );
    });

    const parts: Uint8Array[] = [];
    let length = 0;
    const push = (part: string | Uint8Array) => {
      const bytes = typeof part === "string" ? latin1(part) : part;
      parts.push(bytes);
      length += bytes.length;
    };

    // A binary comment on the second line is what tells a transport that reads
    // the first few bytes that this file is not text and must not be newline-
    // translated on its way to disk.
    push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");

    const offsets = new Map<number, number>();
    for (let id = 1; id <= total; id++) {
      const body = bodies.get(id);
      if (body === undefined) throw new Error(`pdf: object ${id} was never written`);
      offsets.set(id, length);
      push(`${id} 0 obj\n`);
      push(body);
      push("\nendobj\n");
    }

    const startxref = length;
    push(`xref\n0 ${total + 1}\n`);
    // Every entry is exactly 20 bytes, which is what makes the table seekable.
    push("0000000000 65535 f\r\n");
    for (let id = 1; id <= total; id++) {
      push(`${String(offsets.get(id)).padStart(10, "0")} 00000 n\r\n`);
    }
    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}
