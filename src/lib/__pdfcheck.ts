import { writeFileSync } from "node:fs";
import { PdfDocument, clipText, textWidth } from "./pdf";

/**
 * The PDF writer, against the one thing about the format that is unforgiving.
 *
 * Everything a content stream says is either drawn or it is not, and a viewer
 * will tell you which. The **cross-reference table** is different: it is a list
 * of byte offsets into the file itself, so an off-by-one there is not a wrong
 * line on the page, it is a file that some readers open and others refuse — and
 * the ones that refuse are rarely the one you tested in. So the check re-reads
 * the bytes it just wrote the way a reader would: parse the trailer, seek to
 * `startxref`, walk the table, and land on each object's header.
 *
 * The rest is the arithmetic a caller cannot see: that every object named by the
 * page tree exists, that the stream lengths agree with the streams, and that
 * Courier's fixed advance is what the text placement is actually using.
 *
 * It also leaves a real sheet on disk to look at, because none of the above says
 * anything about whether the page is legible.
 *
 * Run from the project root:
 *
 *     npx vite build --ssr src/lib/__pdfcheck.ts --outDir dist-ssr --emptyOutDir && node dist-ssr/__pdfcheck.js
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? ` — ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// A document with one of everything in it
// ---------------------------------------------------------------------------

const doc = new PdfDocument();

const a4 = doc.addPage(297, 210);
a4.rect(0, 0, 297, 210, { fill: "#ffffff" });
a4.rect(10, 10, 277, 190, { stroke: { colour: "#12325c", width: 0.5 } });
a4.lines(
  [
    { x0: 20, y0: 20, x1: 120, y1: 20 },
    { x0: 20, y0: 20, x1: 20, y1: 120 },
    { x0: 20, y0: 120, x1: 120, y1: 120 },
    { x0: 120, y0: 20, x1: 120, y1: 120 },
  ],
  { colour: "#12325c", width: 0.35 }
);
a4.lines([{ x0: 20, y0: 70, x1: 120, y1: 70 }], {
  colour: "#5b7fb5",
  width: 0.18,
  dash: [1.6, 1.1],
});
a4.text("SHOJI LAMP — TEST SHEET", 148.5, 190, { size: 5, font: "monoBold", align: "center" });
a4.text("100", 70, 15, { size: 3, align: "center", underline: true, colour: "#1a7f4b" });
a4.text("(parentheses and a backslash \\)", 20, 130, { size: 3 });
a4.text("40 × 7 × 7", 20, 140, { size: 3 });

const second = doc.addPage(297, 210);
second.text("SHEET 2", 148.5, 105, { size: 8, font: "monoBold", align: "center", baseline: "middle" });

const bytes = doc.build();
const text = Buffer.from(bytes).toString("latin1");

// ---------------------------------------------------------------------------
// The header, the trailer, and the table between them
// ---------------------------------------------------------------------------

check("starts with a PDF header", text.startsWith("%PDF-1.4\n"), text.slice(0, 8));
check(
  "a binary comment on line two, so nothing treats the file as text",
  /^%PDF-1\.4\n%[\x80-\xff]{4}\n/.test(text)
);
check("ends with %%EOF", text.trimEnd().endsWith("%%EOF"));

const startxrefAt = text.lastIndexOf("startxref");
const startxref = Number(text.slice(startxrefAt).match(/startxref\s+(\d+)/)?.[1] ?? -1);
check(
  "startxref points at the xref table",
  startxref >= 0 && text.slice(startxref, startxref + 4) === "xref",
  `offset ${startxref} reads ${JSON.stringify(text.slice(startxref, startxref + 4))}`
);

const size = Number(text.match(/\/Size (\d+)/)?.[1] ?? -1);
const header = text.slice(startxref).match(/xref\n0 (\d+)\n/);
check("the table declares as many entries as the trailer", Number(header?.[1]) === size, `${header?.[1]} against ${size}`);

// Entries are fixed-width by specification: ten digits, a space, five digits, a
// space, the type, and a two-byte end of line. Seeking into the table at all
// depends on that, so it is worth stating rather than assuming.
const tableAt = startxref + (header?.[0].length ?? 0);
const entries: Array<{ offset: number; type: string }> = [];
for (let i = 0; i < size; i++) {
  const entry = text.slice(tableAt + i * 20, tableAt + (i + 1) * 20);
  entries.push({ offset: Number(entry.slice(0, 10)), type: entry[17] });
}
check("every entry is 20 bytes wide", entries.every((e) => e.type === "n" || e.type === "f"), entries.map((e) => e.type).join(""));
check("object 0 is the free head", entries[0]?.type === "f" && entries[0].offset === 0);

// The one that matters: follow each offset and land on that object's header.
let landed = 0;
for (let id = 1; id < size; id++) {
  if (text.slice(entries[id].offset).startsWith(`${id} 0 obj`)) landed++;
}
check(
  "every offset lands on its own object header",
  landed === size - 1,
  `${landed} of ${size - 1}`
);

// ---------------------------------------------------------------------------
// The object graph
// ---------------------------------------------------------------------------

const declared = [...text.matchAll(/(\d+) 0 obj/g)].map((m) => Number(m[1]));
check("objects are written once each, in order", declared.join(",") === Array.from({ length: size - 1 }, (_, i) => i + 1).join(","));

const referenced = new Set([...text.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1])));
const unreferenced = declared.filter((id) => id !== 1 && !referenced.has(id));
check("nothing is written that nothing points at", unreferenced.length === 0, unreferenced.join(","));

const kids = text.match(/\/Kids \[([^\]]*)\]/)?.[1] ?? "";
check("the page tree names both pages", kids.split("0 R").filter((s) => s.trim()).length === 2, kids);
check("the count agrees with the kids", /\/Count 2\b/.test(text));
check("both pages carry the two fonts", (text.match(/\/F1 3 0 R \/F2 4 0 R/g) ?? []).length === 2);
check("no image dictionary on a document with no images", !text.includes("/XObject"));

// Stream lengths are declared before the bytes and are what a reader trusts over
// the `endstream` keyword.
let streamsChecked = 0;
let streamsWrong = 0;
for (const match of text.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
  const declaredLength = Number(match[1]);
  const from = match.index! + match[0].length;
  const actual = text.indexOf("\nendstream", from) - from;
  streamsChecked++;
  if (actual !== declaredLength) streamsWrong++;
}
check("every declared stream length is the stream's length", streamsChecked === 2 && streamsWrong === 0, `${streamsChecked} streams, ${streamsWrong} wrong`);

// ---------------------------------------------------------------------------
// What the page says
// ---------------------------------------------------------------------------

check("the multiplication sign went out as WinAnsi 0xd7", text.includes("40 \xd7 7 \xd7 7"));
check("parentheses and backslashes are escaped", text.includes("\\(parentheses and a backslash \\\\\\)"));
check("the dash pattern reached the stream", /\[[\d.]+ [\d.]+\] 0 d/.test(text));
check("MediaBox is A4 landscape in points", text.includes("/MediaBox [0 0 841.89 595.276]"));

// Courier is the reason text can be centred without a widths table: the advance
// is 0.6 em for every glyph, so a centred string's left edge is exact.
check("Courier's fixed advance", Math.abs(textWidth("12345", 4) - 12) < 1e-9, `${textWidth("12345", 4)} mm`);
// "SHEET 2" at size 8, centred on 148.5 -> left edge at 148.5 - 7*8*0.6/2
const centred = 148.5 - textWidth("SHEET 2", 8) / 2;
check(
  "a centred string starts where the arithmetic says",
  text.includes(`${Math.round(centred * (72 / 25.4) * 1000) / 1000} `),
  `${centred.toFixed(3)} mm`
);

// Nothing in a PDF clips. A cell that overflows is not cut off at its column, it
// is drawn straight over the one beside it — so the only thing keeping a table
// readable is that the text was shortened before it was written.
console.log("\nClipping");
check("a string that fits is left alone", clipText("240 × 7 × 7", 40, 2.6) === "240 × 7 × 7");
check(
  "one that does not comes back inside the width",
  textWidth(clipText("frameHorizontal · d8b37dab-475b-458e", 20, 2.6), 2.6) <= 20,
  `"${clipText("frameHorizontal · d8b37dab-475b-458e", 20, 2.6)}"`
);
check("and says it was cut", clipText("frameHorizontal · d8b37dab", 20, 2.6).endsWith("…"));
check("a width with no room for anything gives nothing", clipText("abc", 0.5, 2.6) === "");

check("page count", doc.pageCount === 2);
check("the file is a plausible size", bytes.length > 1200 && bytes.length < 20000, `${bytes.length} bytes`);

const out = "dist-ssr/__pdfcheck.pdf";
writeFileSync(out, bytes);
console.log(`\nwrote ${out} (${bytes.length} bytes) — open it`);

console.log(failures === 0 ? "\nall good\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
