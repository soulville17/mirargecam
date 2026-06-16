import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

export const maxDuration = 60;
export const runtime = "nodejs";

async function uploadToTmpfiles(buffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([buffer], { type: "image/jpeg" });
  formData.append("file", blob, filename);

  const res = await fetch("https://tmpfiles.org/api/v1/upload", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) throw new Error(`tmpfiles upload failed: ${res.status}`);

  const json = await res.json();
  const pageUrl: string = json?.data?.url;
  if (!pageUrl) throw new Error("No URL from tmpfiles");

  return pageUrl.replace("https://tmpfiles.org/", "https://tmpfiles.org/dl/");
}

export async function POST(request: NextRequest) {
  try {
    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) {
      return NextResponse.json({ error: "FAL_KEY non configure" }, { status: 500 });
    }

    fal.config({ credentials: FAL_KEY });

    const body = await request.json();
    const { source_image, target_image } = body;

    if (!source_image || !target_image) {
      return NextResponse.json(
        { error: "source_image et target_image sont requis" },
        { status: 400 }
      );
    }

    const start = Date.now();

    const sourceB64 = source_image.includes(",") ? source_image.split(",")[1] : source_image;
    const targetB64 = target_image.includes(",") ? target_image.split(",")[1] : target_image;

    const sourceBuffer = Buffer.from(sourceB64, "base64");
    const targetBuffer = Buffer.from(targetB64, "base64");

    const ts = Date.now();
    const [sourceUrl, targetUrl] = await Promise.all([
      uploadToTmpfiles(sourceBuffer, `source_${ts}.jpg`),
      uploadToTmpfiles(targetBuffer, `target_${ts}.jpg`),
    ]);

    const result = await fal.subscribe("fal-ai/face-swap", {
      input: {
        base_image_url: sourceUrl,
        swap_image_url: targetUrl,
      },
    }) as any;

    const imageUrl = result?.data?.image?.url || result?.image?.url;
    if (!imageUrl) {
      return NextResponse.json({ error: "Pas d'image dans la reponse", raw: JSON.stringify(result).slice(0, 300) }, { status: 500 });
    }

    const imgResponse = await fetch(imageUrl);
    const imgBuffer = await imgResponse.arrayBuffer();
    const base64 = Buffer.from(imgBuffer).toString("base64");

    return NextResponse.json({
      success: true,
      output_image: base64,
      processing_time: Date.now() - start,
    });
  } catch (error) {
    console.error("[FaceSwap API Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}