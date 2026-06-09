import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fal } from "@fal-ai/client";

// Vercel timeout 60s
export const maxDuration = 60;

const POINTS_PER_FRAME = 2;

// Configurer fal.ai avec la clé API
fal.config({ credentials: process.env.FAL_KEY });

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const body = await request.json();
    const { source_image, target_image } = body;

    if (!source_image || !target_image) {
      return NextResponse.json(
        { error: "source_image et target_image sont requis" },
        { status: 400 }
      );
    }

    // MODE TEST — points illimités
    const TEST_MODE = true;
    const currentPoints = 999999;

    if (!TEST_MODE) {
      // vérification abonnement ici plus tard
    }

    // Convertir base64 → URL data pour fal.ai
    const sourceDataUrl = `data:image/jpeg;base64,${source_image}`;
    const targetDataUrl = `data:image/jpeg;base64,${target_image}`;

    // Appel fal.ai face-swap
    const result = await fal.run("fal-ai/face-swap", {
      input: {
        base_image_url: targetDataUrl,   // visage cible (caméra)
        swap_image_url: sourceDataUrl,   // visage source (avatar)
      },
    });

    // fal.ai retourne { image: { url: "..." } } ou { images: [...] }
    const outputUrl: string =
      (result as any)?.image?.url ??
      (result as any)?.images?.[0]?.url ??
      (result as any)?.output?.image?.url ??
      null;

    if (!outputUrl) {
      console.error("[FaceSwap fal.ai] Réponse inattendue:", JSON.stringify(result).slice(0, 300));
      return NextResponse.json({ error: "Pas d'image dans la réponse fal.ai" }, { status: 500 });
    }

    // Télécharger l'image résultat et la convertir en base64
    const imgRes = await fetch(outputUrl);
    const imgBuffer = await imgRes.arrayBuffer();
    const output_image = Buffer.from(imgBuffer).toString("base64");

    return NextResponse.json({
      success: true,
      output_image,
      points_remaining: currentPoints - POINTS_PER_FRAME,
    });

  } catch (error) {
    console.error("[FaceSwap API Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
