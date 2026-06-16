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
      return NextResponse.json(
        { error: "source_image et target_image sont requis" },
        { status: 400 }
      );
    }

    const start = Date.now();

    const sourceUri = source_image.startsWith("data:")
      ? source_image
      : `data:image/jpeg;base64,${source_image}`;
    const targetUri = target_image.startsWith("data:")
      ? target_image
      : `data:image/jpeg;base64,${target_image}`;

    const result = await fal.subscribe("fal-ai/face-swap", {
      input: {
        base_image_url: sourceUri,
        swap_image_url: targetUri,
      },
    }) as any;

    const imageUrl = result?.data?.image?.url || result?.image?.url;
    if (!imageUrl) {
      return NextResponse.json({
        error: "Pas d'image dans la reponse",
        raw: JSON.stringify(result).slice(0, 300)
      }, { status: 500 });
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