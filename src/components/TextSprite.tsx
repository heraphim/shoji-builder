import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "../store/useComponentEditorStore";

interface TextSpriteProps {
  text: string;
  position: Vec3;
  // world-space height of the rendered text
  height: number;
  color?: string;
  underline?: boolean;
}

// Text as a camera-facing sprite drawn on a 2D canvas — no font downloads, no
// DOM overlay, works identically inside every scissored View. The underline is
// drawn straight onto the canvas (drafting convention: underlined = value set
// by the user, plain = measured from the model).
export function TextSprite({ text, position, height, color = "#e8f2ff", underline = false }: TextSpriteProps) {
  const { texture, aspect } = useMemo(() => {
    const fontPx = 64;
    const pad = 8;
    // Semibold, not regular: a numeral is rendered a few pixels tall on screen
    // and the thin strokes of a regular weight get eaten by the mipmap, which
    // reads as the text being half transparent rather than merely small.
    const font = `600 ${fontPx}px system-ui, sans-serif`;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = font;
    const metrics = ctx.measureText(text);
    canvas.width = Math.ceil(metrics.width) + pad * 2;
    canvas.height = fontPx + pad * 2 + (underline ? 10 : 0);
    ctx.font = font;
    ctx.textBaseline = "top";
    ctx.fillStyle = color;
    ctx.fillText(text, pad, pad);
    if (underline) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(pad, fontPx + pad + 5);
      ctx.lineTo(canvas.width - pad, fontPx + pad + 5);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { texture, aspect: canvas.width / canvas.height };
  }, [text, color, underline]);

  // A dimension label's text changes with every zoom step, and each change is a
  // fresh CanvasTexture — the most expensive kind of leak here, since a texture
  // holds an image upload rather than a few vertices.
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={[height * aspect, height, 1]} raycast={() => null}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}
