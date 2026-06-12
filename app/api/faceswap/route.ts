import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const runtime = "nodejs";

const FAL_KEY = process.env.FAL_KEY;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    if (!FAL_KEY) {
      return NextResponse.json({ error: "FAL_KEY non configure" }, { status: 500 });
    }

    const body = await request.json();
    const { source_image, target_image } = body;

    if (!source_image || !target_image) {
      return NextResponse.json(
        { error: "source_image et target_image sont requis" },
        { status: 400 }
      );
    }

    const start = Date.now();

    const response = await fetch("https://fal.run/fal-ai/face-swap", {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        base_image_url: source_image,
        swap_image_url: target_image,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: "Face swap échoué", details: errorText },
        { status: response.status }
      );
    }

    const result = await response.json();
    const imageUrl = result.image?.url || result.image;

    if (!imageUrl) {
      return NextResponse.json({ error: "Pas d'image dans la réponse" }, { status: 500 });
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