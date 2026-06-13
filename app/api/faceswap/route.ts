import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

export const maxDuration = 60;
export const runtime = "nodejs";

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
      return NextResponse.json({ error: "Images manquantes" }, { status: 400 });
    }

    const start = Date.now();

    const sourceB64 = source_image.includes(",") ? source_image.split(",")[1] : source_image;
    const targetB64 = target_image.includes(",") ? target_image.split(",")[1] : target_image;

    let sourceUrl: string;
    let targetUrl: string;

    try {
      const sourceBlob = new Blob([Buffer.from(sourceB64, "base64")], { type: "image/jpeg" });
      const targetBlob = new Blob([Buffer.from(targetB64, "base64")], { type: "image/jpeg" });
      [sourceUrl, targetUrl] = await Promise.all([
        fal.storage.upload(sourceBlob),
        fal.storage.upload(targetBlob),
      ]);
    } catch (uploadError: any) {
      return NextResponse.json({ error: "Upload echoue", details: uploadError.message }, { status: 500 });
    }

    let result: any;
    try {
      result = await fal.subscribe("fal-ai/face-swap", {
        input: { base_image_url: sourceUrl, swap_image_url: targetUrl },
      });
    } catch (falError: any) {
      return NextResponse.json({ error: "fal.ai echoue", details: falError.message }, { status: 500 });
    }

    const imageUrl = result?.data?.image?.url || result?.image?.url;
    if (!imageUrl) {
      return NextResponse.json({ error: "Pas d image", raw: JSON.stringify(result).slice(0, 300) }, { status: 500 });
    }

    const imgBuffer = await (await fetch(imageUrl)).arrayBuffer();
    const base64 = Buffer.from(imgBuffer).toString("base64");

    return NextResponse.json({
      success: true,
      output_image: base64,
      processing_time: Date.now() - start,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Erreur serveur" }, { status: 500 });
  }
}